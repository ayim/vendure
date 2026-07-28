import {Controller, Get, Headers, NotFoundException, ServiceUnavailableException} from '@nestjs/common';
import {PluginCommonModule, VendurePlugin} from '@vendure/core';

@Controller('health')
class HealthController {
    @Get()
    check() {
        return {
            status: 'ok',
            service: 'vendure-overwatch-demo',
            release: {
                version: process.env.APP_VERSION ?? 'local',
                revision: process.env.VCS_REF_REVISION ?? 'local',
                ref: process.env.VCS_REF_NAME ?? 'local',
                environment: process.env.APP_ENV ?? 'local',
            },
            timestamp: new Date().toISOString(),
        };
    }

    @Get('controlled-failure')
    controlledFailure(@Headers('x-demo-failure-token') token?: string) {
        const expectedToken = process.env.DEMO_FAILURE_TOKEN;
        if (!expectedToken || token !== expectedToken) {
            throw new NotFoundException();
        }
        throw new ServiceUnavailableException('Synthetic checkout dependency failure');
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [HealthController],
})
export class HealthPlugin {}
