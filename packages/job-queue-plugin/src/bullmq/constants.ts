import { JobType } from 'bullmq';

export const loggerCtx = 'BullMQJobQueuePlugin';
export const BULLMQ_PLUGIN_OPTIONS = Symbol('BULLMQ_PLUGIN_OPTIONS');
export const QUEUE_NAME = 'vendure-job-queue';
export const DEFAULT_CONCURRENCY = 3;
/** Job name used inside each BullMQ queue when using separate queues per job type */
export const DEFAULT_JOB_NAME = 'job';

export function getBullQueueName(vendureQueueName: string): string {
    return `${QUEUE_NAME}-${vendureQueueName}`;
}

export const ALL_JOB_TYPES: JobType[] = [
    'completed',
    'failed',
    'delayed',
    'repeat',
    'waiting-children',
    'active',
    'wait',
    'paused',
    'prioritized',
];
