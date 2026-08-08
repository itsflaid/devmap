import { Router } from "express";
import Stripe from "stripe";

export const paymentsRouter = Router();

paymentsRouter.get("/", (_req, res) => {
  res.json({ ok: true });
});

export const stripe = new Stripe("fixture-key");
