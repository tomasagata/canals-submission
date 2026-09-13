import { OrderDocument } from '../schemas/order.schema.js';
import { OrderStatus, isTerminal } from '../order-status.js';
import { PaymentResultDto } from '../../payment/dto/index.js';

export class OrderItemResponseDto {
    productId: string;
    quantity: number;
    unitPrice: number;
}

export class OrderResponseDto {
    orderId: string;
    status: OrderStatus;
    /** True once the order has reached a state that will never change again. */
    settled: boolean;
    customerId: string;
    shippingAddress: string;
    items: OrderItemResponseDto[];
    totalAmount: number;
    /** Only present once the saga has actually reserved stock somewhere. */
    servingWarehouseId?: string;
    paymentResult?: PaymentResultDto;
    failureCode?: string;
    error?: string;
    createdAt?: Date;
    updatedAt?: Date;
    /** Where to poll for the settled outcome. */
    self: string;

    static from(order: OrderDocument): OrderResponseDto {
        return {
            orderId: order._id.toString(),
            status: order.status,
            settled: isTerminal(order.status),
            customerId: order.customerId.toString(),
            shippingAddress: order.shippingAddress,
            items: order.items.map((item) => ({
                productId: item.productId.toString(),
                quantity: item.quantity,
                unitPrice: item.unitPrice,
            })),
            totalAmount: order.totalAmount,
            servingWarehouseId: order.warehouseId?.toString(),
            paymentResult: order.paymentResult,
            failureCode: order.failureCode,
            error: order.errorMessage,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
            self: `/orders/${order._id.toString()}`,
        };
    }
}

export class PaginatedOrdersDto {
    items: OrderResponseDto[];
    total: number;
    page: number;
    limit: number;
}
