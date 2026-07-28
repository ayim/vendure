'use client';

import posthog from 'posthog-js';
import {useEffect} from 'react';

export function OrderConfirmedEvent({
    orderCode,
    totalWithTax,
    currencyCode,
}: {
    orderCode: string;
    totalWithTax: number;
    currencyCode: string;
}) {
    useEffect(() => {
        posthog.capture('order_completed', {
            order_code: orderCode,
            total_with_tax: totalWithTax,
            currency_code: currencyCode,
            critical_path: 'checkout',
        });
    }, [currencyCode, orderCode, totalWithTax]);

    return null;
}
