import { Badge } from '@/vdb/components/ui/badge.js';
import { Link } from '@tanstack/react-router';
import { Edit2, X } from 'lucide-react';

interface ProductOptionGroupBadgeProps {
    id: string;
    name: string;
    productId: string;
    onRemove?: () => void;
}

export function ProductOptionGroupBadge({ id, name, productId, onRemove }: ProductOptionGroupBadgeProps) {
    return (
        <Badge variant="secondary" className="text-xs">
            <span>{name}</span>
            <Link
                to={`/option-groups/${id}`}
                search={{ from: 'product', productId }}
                className="ml-1.5 inline-flex"
            >
                <Edit2 className="h-3 w-3" />
            </Link>
            {onRemove && (
                <button
                    type="button"
                    onClick={onRemove}
                    className="ml-1 inline-flex"
                    aria-label="Remove option group"
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </Badge>
    );
}
