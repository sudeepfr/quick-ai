

import express from 'express'
import cors from 'cors';
import 'dotenv/config';
import { clerkMiddleware, requireAuth } from '@clerk/express'
import aiRouter from './routes/aiRoutes.js';
import connectCloudinary from './configs/cloudinary.js';
import userRouter from './routes/userRoutes.js';

const app=express();
const PORT=process.env.PORT||3000;
app.use(cors());
app.use(express.json());
await connectCloudinary();
 
app.use(clerkMiddleware())
app.get('/',(req,res)=>{
     res.send('API is working..');
})

app.use(requireAuth());//whichever route is declere after this middleware that all will be protected by this middleware only login user can access these route
app.use("/api/ai",aiRouter);
app.use('/api/user',userRouter);

app.listen(PORT,()=>{
     console.log("Server is running on port "+PORT)
})  