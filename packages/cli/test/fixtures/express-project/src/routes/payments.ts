import { Router } from "express";
import Stripe from "stripe";

export const paymentsRouter = Router();
export const stripe = new Stripe("fixture-key");
