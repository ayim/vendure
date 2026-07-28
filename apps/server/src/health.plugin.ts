import {Controller, Get, Headers, NotFoundException, ServiceUnavailableException} from '@nestjs/common';
import {PluginCommonModule, VendurePlugin} from '@vendure/core';

@Controller('health')
class HealthController {
    @Get()
    check() {
        return {
            status: 'ok',
            service: 'vendure-overwatch-demo',
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
