import { JobListOptions, JobState } from '@vendure/common/lib/generated-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import {
    ID,
    Injector,
    InspectableJobQueueStrategy,
    InternalServerError,
    Job,
    JobData,
    Logger,
    PaginatedList,
} from '@vendure/core';
import Bull, {
    Job as BullJob,
    ConnectionOptions,
    JobType,
    Processor,
    Queue,
    Worker,
    WorkerOptions,
} from 'bullmq';
import { EventEmitter } from 'events';
import { Cluster, Redis, RedisOptions } from 'ioredis';
import { Subject } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';

import {
    ALL_JOB_TYPES,
    BULLMQ_PLUGIN_OPTIONS,
    DEFAULT_CONCURRENCY,
    DEFAULT_JOB_NAME,
    getBullQueueName,
    loggerCtx,
    QUEUE_NAME,
} from './constants';
import { JobListIndexService } from './job-list-index.service';
import { RedisHealthIndicator } from './redis-health-indicator';
import { getJobsByType } from './scripts/get-jobs-by-type';
import { BullMQPluginOptions, CustomScriptDefinition } from './types';
import { flattenJobFilter, getPrefix } from './utils';

/**
 * @description
 * This JobQueueStrategy uses [BullMQ](https://docs.bullmq.io/) to implement a push-based job queue
 * on top of Redis. It should not be used alone, but as part of the {@link BullMQJobQueuePlugin}.
 *
 * Note: To use this strategy, you need to manually install the `bullmq` package:
 *
 * ```shell
 * npm install bullmq@^5.4.2
 * ```
 *
 * @docsCategory core plugins/JobQueuePlugin
 */
interface QueueEntry {
    queue: Queue;
    worker?: Worker;
}

export class BullMQJobQueueStrategy implements InspectableJobQueueStrategy {
    private redisConnection: Redis | Cluster;
    private connectionOptions: ConnectionOptions;
    private queue: Queue | undefined;
    /**
     * Workers are grouped by their concurrency value (single BullMQ queue mode).
     * Key: concurrency number, Value: Worker instance.
     * Multiple Vendure queues with the same concurrency share a single worker.
     */
    private workers = new Map<number, Worker>();
    private workerProcessor: Processor | undefined;
    private options: BullMQPluginOptions;
    private jobListIndexService: JobListIndexService;
    private readonly queueNameProcessFnMap = new Map<string, (job: Job) => Promise<any>>();
    private cancellationSub: Redis;
    private cancellationSubscribed = false;
    private readonly cancelRunningJob$ = new Subject<string>();
    private readonly CANCEL_JOB_CHANNEL = 'cancel-job';
    private readonly CANCELLED_JOB_LIST_NAME = 'vendure:cancelled-jobs';
    /** When set, each Vendure queue has its own BullMQ queue+worker (for per-queue concurrency) */
    private readonly queueMap = new Map<string, QueueEntry>();
    private get separateQueuesMode(): boolean {
        const opts = this.options.queueWorkerOptions;
        return !!(opts && Object.keys(opts).length > 0);
    }

    async init(injector: Injector): Promise<void> {
        const options = injector.get<BullMQPluginOptions>(BULLMQ_PLUGIN_OPTIONS);
        this.jobListIndexService = injector.get(JobListIndexService);
        this.options = {
            ...options,
            workerOptions: {
                ...options.workerOptions,
                removeOnComplete: options.workerOptions?.removeOnComplete ?? {
                    age: 60 * 60 * 24 * 30,
                    count: 5000,
                },
                removeOnFail: options.workerOptions?.removeOnFail ?? { age: 60 * 60 * 24 * 30, count: 5000 },
            },
        };
        this.connectionOptions =
            options.connection ??
            ({ host: 'localhost', port: 6379, maxRetriesPerRequest: null } as RedisOptions);

        this.redisConnection =
            this.connectionOptions instanceof EventEmitter
                ? this.connectionOptions
                : new Redis(this.connectionOptions);

        this.defineCustomLuaScripts();

        const redisHealthIndicator = injector.get(RedisHealthIndicator);
        Logger.info('Checking Redis connection...', loggerCtx);
        const health = await redisHealthIndicator.isHealthy('redis');
        if (health.redis.status === 'down') {
            Logger.error('Could not connect to Redis', loggerCtx);
        } else {
            Logger.info('Connected to Redis ✔', loggerCtx);
        }

        if (!this.separateQueuesMode) {
            this.queue = new Queue(QUEUE_NAME, { ...options.queueOptions, connection: this.redisConnection })
                .on('error', (e: any) =>
                    Logger.error(`BullMQ Queue error: ${JSON.stringify(e.message)}`, loggerCtx, e.stack),
                )
                .on('resumed', () => Logger.verbose('BullMQ Queue resumed', loggerCtx))
                .on('paused', () => Logger.verbose('BullMQ Queue paused', loggerCtx));

            if (await this.queue.isPaused()) {
                await this.queue.resume();
            }

            this.workerProcessor = async bullJob => this.processBullJob(bullJob, bullJob.name);
            this.jobListIndexService.register(this.redisConnection, this.queue);
        }

        // Subscription-mode Redis connection for the cancellation messages
        this.cancellationSub = new Redis(this.connectionOptions as RedisOptions);
    }

    private async processBullJob(bullJob: Bull.Job, vendureQueueName: string): Promise<any> {
        Logger.debug(
            `Job ${bullJob.id ?? ''} [${vendureQueueName}] starting (attempt ${bullJob.attemptsMade + 1} of ${
                bullJob.opts.attempts ?? 1
            })`,
        );
        const processFn = this.queueNameProcessFnMap.get(vendureQueueName);
        if (!processFn) {
            throw new InternalServerError(`No processor defined for the queue "${vendureQueueName}"`);
        }
        const job = await this.createVendureJob(bullJob, vendureQueueName);
        const completed$ = new Subject<void>();
        try {
            // eslint-disable-next-line
            job.on('progress', _job => bullJob.updateProgress(_job.progress));

            this.cancelRunningJob$
                .pipe(
                    filter(jobId => jobId === job.id),
                    takeUntil(completed$),
                )
                .subscribe(() => {
                    Logger.info(`Setting job ${job.id ?? ''} as cancelled`, loggerCtx);
                    job.cancel();
                });
            const result = await processFn(job);

            await bullJob.updateProgress(100);
            return result;
        } catch (e: any) {
            throw e;
        } finally {
            if (job.id) {
                await this.redisConnection.srem(this.CANCELLED_JOB_LIST_NAME, job.id?.toString());
            }
            completed$.next();
            completed$.complete();
        }
    }

    async destroy() {
        if (this.separateQueuesMode) {
            await Promise.all(
                Array.from(this.queueMap.values()).flatMap(entry => [
                    entry.queue.close(),
                    entry.worker?.close() ?? Promise.resolve(),
                ]),
            );
        } else {
            const workerClosePromises = Array.from(this.workers.values()).map(w => w.close());
            await Promise.all([this.queue?.close(), ...workerClosePromises].filter(Boolean));
        }
    }

    async add<Data extends JobData<Data> = object>(job: Job<Data>): Promise<Job<Data>> {
        const retries = this.options.setRetries?.(job.queueName, job) ?? job.retries ?? 0;
        const backoff = this.options.setBackoff?.(job.queueName, job) ?? {
            delay: 1000,
            type: 'exponential',
        };
        const customJobOptions = this.options.setJobOptions?.(job.queueName, job) ?? {};
        const queue = this.separateQueuesMode
            ? this.getOrCreateQueue(job.queueName).queue
            : this.queue!;
        const jobName = this.separateQueuesMode ? DEFAULT_JOB_NAME : job.queueName;
        const bullJob = await queue.add(jobName, job.data, {
            attempts: typeof retries === 'number' ? retries + 1 : 1,
            backoff: typeof backoff === 'number' || 'type' in backoff ? backoff : undefined,
            ...customJobOptions,
        });
        return this.createVendureJob(bullJob, this.separateQueuesMode ? job.queueName : undefined);
    }

    async cancelJob(jobId: string): Promise<Job | undefined> {
        const { queue, bullId } = this.resolveJobId(jobId);
        if (!queue) return undefined;
        const bullJob = await queue.getJob(bullId);
        if (bullJob) {
            if (await bullJob.isActive()) {
                await this.setActiveJobAsCancelled(jobId);
                return this.createVendureJob(bullJob, this.separateQueuesMode ? this.getVendureQueueName(queue) : undefined);
            } else {
                try {
                    const job = await this.createVendureJob(
                        bullJob,
                        this.separateQueuesMode ? this.getVendureQueueName(queue) : undefined,
                    );
                    await bullJob.remove();
                    return job;
                } catch (e: any) {
                    const message = `Error when cancelling job: ${JSON.stringify(e.message)}`;
                    Logger.error(message, loggerCtx);
                    throw new InternalServerError(message);
                }
            }
        }
    }

    async findMany(options?: JobListOptions): Promise<PaginatedList<Job>> {
        const skip = options?.skip ?? 0;
        const take = options?.take ?? 10;
        let jobTypes: JobType[] = ALL_JOB_TYPES;

        const flatFilter = flattenJobFilter(options?.filter);

        const stateFilter = flatFilter.state;
        if (stateFilter?.eq) {
            switch (stateFilter.eq) {
                case 'PENDING':
                    jobTypes = ['wait', 'waiting-children', 'prioritized'];
                    break;
                case 'RUNNING':
                    jobTypes = ['active'];
                    break;
                case 'COMPLETED':
                    jobTypes = ['completed'];
                    break;
                case 'RETRYING':
                    jobTypes = ['repeat'];
                    break;
                case 'FAILED':
                    jobTypes = ['failed'];
                    break;
                case 'CANCELLED':
                    jobTypes = ['failed'];
                    break;
            }
        }
        if (stateFilter?.in?.length) {
            const stateJobTypes: JobType[] = [];
            for (const state of stateFilter.in) {
                switch (state) {
                    case 'PENDING':
                        stateJobTypes.push('wait', 'waiting-children', 'prioritized');
                        break;
                    case 'RUNNING':
                        stateJobTypes.push('active');
                        break;
                    case 'COMPLETED':
                        stateJobTypes.push('completed');
                        break;
                    case 'RETRYING':
                        stateJobTypes.push('repeat');
                        break;
                    case 'FAILED':
                        stateJobTypes.push('failed');
                        break;
                    case 'CANCELLED':
                        stateJobTypes.push('failed');
                        break;
                }
            }
            if (stateJobTypes.length) {
                jobTypes = [...new Set(stateJobTypes)];
            }
        }
        const settledFilter = flatFilter.isSettled;
        if (settledFilter?.eq != null) {
            jobTypes =
                settledFilter.eq === true
                    ? ['completed', 'failed']
                    : ['wait', 'waiting-children', 'active', 'repeat', 'delayed', 'paused', 'prioritized'];
        }

        const queueNameFilter = flatFilter.queueName;
        const queueName = queueNameFilter?.eq ?? queueNameFilter?.in?.[0] ?? '';

        if (this.separateQueuesMode) {
            return this.findManySeparateQueues(skip, take, jobTypes, queueName);
        }

        let items: Bull.Job[] = [];
        let totalItems = 0;

        try {
            const [total, jobIds] = await this.callCustomScript(getJobsByType, this.queue!, [
                skip,
                take,
                queueName,
                ...jobTypes,
            ]);
            items = (
                await Promise.all(
                    jobIds.map(id => {
                        return BullJob.fromId(this.queue!, id);
                    }),
                )
            ).filter(notNullOrUndefined);
            totalItems = total;
        } catch (e: any) {
            throw new InternalServerError(e.message);
        }

        return { items: await Promise.all(items.map(bullJob => this.createVendureJob(bullJob))), totalItems };
    }

    async findManyById(ids: ID[]): Promise<Job[]> {
        if (this.separateQueuesMode) {
            const results = await Promise.all(
                ids.map(id => {
                    const resolved = this.resolveJobId(id.toString());
                    if (!resolved?.queue) return undefined;
                    return resolved.queue.getJob(resolved.bullId);
                }),
            );
            const withQueue = results.map((bullJob, i) => {
                if (!bullJob) return undefined;
                const resolved = this.resolveJobId(ids[i].toString());
                return resolved?.queue
                    ? this.createVendureJob(bullJob, this.getVendureQueueName(resolved.queue))
                    : undefined;
            });
            const defined = withQueue.filter((x): x is Promise<Job> => x != null);
            return Promise.all(defined);
        }
        const bullJobs = await Promise.all(ids.map(id => this.queue!.getJob(id.toString())));
        return Promise.all(bullJobs.filter(notNullOrUndefined).map(j => this.createVendureJob(j)));
    }

    async findOne(id: ID): Promise<Job | undefined> {
        const resolved = this.resolveJobId(id.toString());
        if (!resolved?.queue) return undefined;
        const bullJob = await resolved.queue.getJob(resolved.bullId);
        if (bullJob) {
            return this.createVendureJob(
                bullJob,
                this.separateQueuesMode ? this.getVendureQueueName(resolved.queue) : undefined,
            );
        }
    }

    // TODO V2: actually make it use the olderThan parameter
    async removeSettledJobs(queueNames?: string[], olderThan?: Date): Promise<number> {
        try {
            if (this.separateQueuesMode) {
                const toClean = queueNames?.length
                    ? queueNames.map(name => this.queueMap.get(name)?.queue).filter(notNullOrUndefined)
                    : Array.from(this.queueMap.values()).map(e => e.queue);
                let total = 0;
                for (const queue of toClean) {
                    const jobCounts = await queue.getJobCounts('completed', 'failed');
                    await queue.clean(100, 0, 'completed');
                    await queue.clean(100, 0, 'failed');
                    total += Object.values(jobCounts).reduce((sum, num) => sum + num, 0);
                }
                return total;
            }
            const jobCounts = await this.queue!.getJobCounts('completed', 'failed');
            await this.queue!.clean(100, 0, 'completed');
            await this.queue!.clean(100, 0, 'failed');
            return Object.values(jobCounts).reduce((sum, num) => sum + num, 0);
        } catch (e: any) {
            Logger.error(e.message, loggerCtx, e.stack);
            return 0;
        }
    }

    async start<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ): Promise<void> {
        this.queueNameProcessFnMap.set(queueName, process);
        if (this.separateQueuesMode) {
            const entry = this.getOrCreateQueue(queueName);
            if (entry.worker) return;
            const workerOptions: WorkerOptions = {
                concurrency: DEFAULT_CONCURRENCY,
                ...this.options.workerOptions,
                ...this.options.queueWorkerOptions?.[queueName],
                connection: this.redisConnection,
            };
            const processor = async (bullJob: Bull.Job) => this.processBullJob(bullJob, queueName);
            entry.worker = new Worker(entry.queue.name, processor, workerOptions)
                .on('error', e => Logger.error(`BullMQ Worker error: ${e.message}`, loggerCtx, e.stack))
                .on('closing', e => Logger.verbose(`BullMQ Worker closing: ${e}`, loggerCtx))
                .on('closed', () => Logger.verbose('BullMQ Worker closed', loggerCtx))
                .on('failed', (job: Bull.Job | undefined, error) => {
                    Logger.warn(
                        `Job ${job?.id ?? '(unknown id)'} [${queueName}] failed (attempt ${
                            job?.attemptsMade ?? 'unknown'
                        } of ${job?.opts.attempts ?? 1})`,
                        loggerCtx,
                    );
                })
                .on('stalled', (jobId: string) => {
                    Logger.warn(`BullMQ Worker: job ${jobId} stalled`, loggerCtx);
                })
                .on('completed', (job: Bull.Job) => {
                    Logger.debug(`Job ${job?.id ?? 'unknown id'} [${queueName}] completed`, loggerCtx);
                });
            if (!this.cancellationSubscribed) {
                this.cancellationSubscribed = true;
                await this.cancellationSub.subscribe(this.CANCEL_JOB_CHANNEL);
                this.cancellationSub.on('message', this.subscribeToCancellationEvents);
            }
            return;
        }

        // Resolve concurrency: either per-queue via function or a single global value.
        // Workers are stored in `this.workers` keyed by concurrency number, not queue name.
        const concurrency =
            typeof this.options.concurrency === 'function'
                ? this.options.concurrency(queueName)
                : (this.options.concurrency ?? DEFAULT_CONCURRENCY);

        if (!this.workers.has(concurrency)) {
            const options: WorkerOptions = {
                concurrency,
                ...this.options.workerOptions,
                connection: this.redisConnection,
            };
            const worker = new Worker(QUEUE_NAME, this.workerProcessor!, options)
                .on('error', e => Logger.error(`BullMQ Worker error: ${e.message}`, loggerCtx, e.stack))
                .on('closing', e => Logger.verbose(`BullMQ Worker closing: ${e}`, loggerCtx))
                .on('closed', () => Logger.verbose('BullMQ Worker closed', loggerCtx))
                .on('failed', (job: Bull.Job | undefined, error) => {
                    Logger.warn(
                        `Job ${job?.id ?? '(unknown id)'} [${job?.name ?? 'unknown name'}] failed (attempt ${
                            job?.attemptsMade ?? 'unknown'
                        } of ${job?.opts.attempts ?? 1})`,
                        loggerCtx,
                    );
                })
                .on('stalled', (jobId: string) => {
                    Logger.warn(`BullMQ Worker: job ${jobId} stalled`, loggerCtx);
                })
                .on('completed', (job: Bull.Job) => {
                    Logger.debug(`Job ${job?.id ?? 'unknown id'} [${job.name}] completed`, loggerCtx);
                });
            this.workers.set(concurrency, worker);
        }

        if (!this.cancellationSubscribed) {
            this.cancellationSubscribed = true;
            await this.cancellationSub.subscribe(this.CANCEL_JOB_CHANNEL);
            this.cancellationSub.on('message', this.subscribeToCancellationEvents);
        }
    }

    private readonly subscribeToCancellationEvents = (channel: string, jobId: string) => {
        if (channel === this.CANCEL_JOB_CHANNEL && jobId) {
            this.cancelRunningJob$.next(jobId);
        }
    };

    private stopped = false;

    async stop<Data extends JobData<Data> = object>(
        queueName: string,
        process: (job: Job<Data>) => Promise<any>,
    ): Promise<void> {
        if (!this.stopped) {
            this.stopped = true;
            try {
                Logger.info(`Closing worker(s)`, loggerCtx);

                if (this.separateQueuesMode) {
                    const closeAll = async () => {
                        for (const [name, entry] of this.queueMap) {
                            if (entry.worker) {
                                const activeCount = await entry.queue.getActiveCount();
                                if (activeCount > 0) {
                                    const activeJobs = await entry.queue.getActive();
                                    Logger.info(
                                        `Waiting on ${activeCount} active job(s) in ${name} (${activeJobs.map(j => j.id).join(', ')})...`,
                                        loggerCtx,
                                    );
                                    setTimeout(closeAll, 2000);
                                    return;
                                }
                                await entry.worker.close();
                            }
                            await entry.queue.close();
                        }
                        this.cancellationSub.off('message', this.subscribeToCancellationEvents);
                    };
                    await closeAll();
                } else {
                    let timer: NodeJS.Timeout;
                    const checkActive = async () => {
                        const activeCount = await this.queue!.getActiveCount();
                        if (0 < activeCount) {
                            const activeJobs = await this.queue!.getActive();
                            Logger.info(
                                `Waiting on ${activeCount} active ${
                                    activeCount > 1 ? 'jobs' : 'job'
                                } (${activeJobs.map(j => j.id).join(', ')})...`,
                                loggerCtx,
                            );
                            timer = setTimeout(() => {
                                void checkActive();
                            }, 2000);
                        }
                    };
                    timer = setTimeout(() => {
                        void checkActive();
                    }, 2000);

                    for (const worker of this.workers.values()) {
                        await worker.close();
                    }
                    Logger.info(`Worker(s) closed`, loggerCtx);
                    await this.queue!.close();
                    clearTimeout(timer);
                    Logger.info(`Queue closed`, loggerCtx);
                    this.cancellationSub.off('message', this.subscribeToCancellationEvents);
                }
            } catch (e: any) {
                Logger.error(e, loggerCtx, e.stack);
            }
        }
    }

    private async setActiveJobAsCancelled(jobId: string) {
        // Not yet possible natively in BullMQ, see
        // https://github.com/taskforcesh/bullmq/issues/632
        // So we have our own custom method of marking a job as cancelled.
        await this.redisConnection.publish(this.CANCEL_JOB_CHANNEL, jobId);
        await this.redisConnection.sadd(this.CANCELLED_JOB_LIST_NAME, jobId.toString());
    }

    private getOrCreateQueue(vendureQueueName: string): QueueEntry {
        let entry = this.queueMap.get(vendureQueueName);
        if (entry) return entry;
        const bullQueueName = getBullQueueName(vendureQueueName);
        const queue = new Queue(bullQueueName, {
            ...this.options.queueOptions,
            connection: this.redisConnection,
        })
            .on('error', (e: any) =>
                Logger.error(`BullMQ Queue error: ${JSON.stringify(e.message)}`, loggerCtx, e.stack),
            )
            .on('resumed', () => Logger.verbose('BullMQ Queue resumed', loggerCtx))
            .on('paused', () => Logger.verbose('BullMQ Queue paused', loggerCtx));
        entry = { queue };
        this.queueMap.set(vendureQueueName, entry);
        this.jobListIndexService.register(this.redisConnection, queue);
        return entry;
    }

    /**
     * In separate-queue mode, job ids are "vendureQueueName:bullId". Otherwise single queue and id is bullId.
     */
    private resolveJobId(jobId: string): { queue: Queue; bullId: string } | null {
        if (this.separateQueuesMode) {
            const idx = jobId.indexOf(':');
            if (idx === -1) return null;
            const vendureQueueName = jobId.slice(0, idx);
            const bullId = jobId.slice(idx + 1);
            const entry = this.queueMap.get(vendureQueueName);
            return entry ? { queue: entry.queue, bullId } : null;
        }
        return this.queue ? { queue: this.queue, bullId: jobId } : null;
    }

    private getVendureQueueName(queue: Queue): string {
        const prefix = QUEUE_NAME + '-';
        return queue.name.startsWith(prefix) ? queue.name.slice(prefix.length) : queue.name;
    }

    private async findManySeparateQueues(
        skip: number,
        take: number,
        jobTypes: JobType[],
        queueNameFilter: string,
    ): Promise<PaginatedList<Job>> {
        const queuesToQuery =
            queueNameFilter && this.queueMap.has(queueNameFilter)
                ? [[queueNameFilter, this.queueMap.get(queueNameFilter)!] as const]
                : Array.from(this.queueMap.entries());
        let totalItems = 0;
        const allCandidates: Array<{ vendureQueueName: string; bullId: string; queue: Queue }> = [];

        for (const [vendureQueueName, entry] of queuesToQuery) {
            if (queueNameFilter && vendureQueueName !== queueNameFilter) continue;
            try {
                const [total, jobIds] = await this.callCustomScript(getJobsByType, entry.queue, [
                    0,
                    skip + take,
                    DEFAULT_JOB_NAME,
                    ...jobTypes,
                ]);
                totalItems += total;
                for (const bullId of jobIds) {
                    allCandidates.push({ vendureQueueName, bullId, queue: entry.queue });
                }
            } catch (e: any) {
                throw new InternalServerError(e.message);
            }
        }

        const bullJobs = await Promise.all(
            allCandidates.map(({ queue, bullId }) => BullJob.fromId(queue, bullId)),
        );
        const withTimestamp = bullJobs
            .map((job, i) => (job ? { job, vendureQueueName: allCandidates[i].vendureQueueName } : null))
            .filter(notNullOrUndefined) as Array<{ job: Bull.Job; vendureQueueName: string }>;
        const jobJson = (j: Bull.Job) => j.toJSON();
        withTimestamp.sort((a, b) => (jobJson(b.job).timestamp ?? 0) - (jobJson(a.job).timestamp ?? 0));
        const paginated = withTimestamp.slice(skip, skip + take);
        const items = await Promise.all(
            paginated.map(({ job, vendureQueueName }) =>
                this.createVendureJob(job, vendureQueueName),
            ),
        );
        return { items, totalItems };
    }

    private async createVendureJob(bullJob: Bull.Job, vendureQueueName?: string): Promise<Job> {
        const jobJson = bullJob.toJSON();
        const id =
            vendureQueueName != null ? `${vendureQueueName}:${bullJob.id}` : (bullJob.id?.toString() ?? '');
        const queueName = vendureQueueName ?? bullJob.name;
        return new Job({
            queueName,
            id,
            state: await this.getState(bullJob, vendureQueueName),
            data: bullJob.data,
            attempts: bullJob.attemptsMade,
            createdAt: new Date(jobJson.timestamp),
            startedAt: jobJson.processedOn ? new Date(jobJson.processedOn) : undefined,
            settledAt: jobJson.finishedOn ? new Date(jobJson.finishedOn) : undefined,
            error: jobJson.failedReason,
            progress: +jobJson.progress,
            result: jobJson.returnvalue,
            retries: bullJob.opts.attempts ? bullJob.opts.attempts - 1 : 0,
        });
    }

    private async getState(bullJob: Bull.Job, vendureQueueName?: string): Promise<JobState> {
        const jobId =
            vendureQueueName != null
                ? `${vendureQueueName}:${bullJob.id}`
                : bullJob.id?.toString();
        const state = await bullJob.getState();
        switch (state) {
            case 'completed':
                return JobState.COMPLETED;
            case 'failed':
                return JobState.FAILED;
            case 'waiting':
            case 'waiting-children':
            case 'prioritized':
                return JobState.PENDING;
            case 'delayed':
                return JobState.RETRYING;
            case 'active': {
                const isCancelled =
                    jobId && (await this.redisConnection.sismember(this.CANCELLED_JOB_LIST_NAME, jobId));
                return isCancelled ? JobState.CANCELLED : JobState.RUNNING;
            }
            case 'unknown':
            default: {
                Logger.error(
                    `Could not determine job state for job ${jobId ?? '(unknown ID)'}: ${state}`,
                    loggerCtx,
                );
                // We need to return a valid state, so we default to FAILED.
                return JobState.FAILED;
            }
        }
    }

    private callCustomScript<T, Args extends any[]>(
        scriptDef: CustomScriptDefinition<T, Args>,
        queue: Queue,
        args: Args,
    ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const prefix = getPrefix(this.options);
            (this.redisConnection as any)[scriptDef.name](
                `${prefix}:${queue.name}:`,
                ...args,
                (err: any, result: any) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                },
            );
        });
    }

    private defineCustomLuaScripts() {
        const redis = this.redisConnection;
        redis.defineCommand(getJobsByType.name, {
            numberOfKeys: getJobsByType.numberOfKeys,
            lua: getJobsByType.script,
        });
    }
}
