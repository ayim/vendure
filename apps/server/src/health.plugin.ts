import {Controller, Get} from '@nestjs/common';
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
}

@VendurePlugin({
    imports: [PluginCommonModule],
    controllers: [HealthController],
})
export class HealthPlugin {}
