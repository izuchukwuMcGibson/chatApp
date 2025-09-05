import express from "express";
import message from "../models/message.js";
const router = express.Router();
import { signUp,login } from "../controllers/user.controller.js";
// Example signup
router.post("/signup", signUp)

// Example login
router.post("/login", login )

export default router;
