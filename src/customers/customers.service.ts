import { Injectable } from "@nestjs/common";
import { Customer } from "./schemas/customers.schema.js";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

@Injectable()
export class CustomersService {
    constructor(@InjectModel(Customer.name) private customerModel: Model<Customer>) {}
    
    async getCustomerById(id: string): Promise<Customer | null> {
        return this.customerModel.findById(id).exec();
    }
}