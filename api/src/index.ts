import 'dotenv/config';
import express from 'express';
import jobsRouter from './routes/jobs';
import cors from 'cors';

const app =  express();
app.use(cors());

app.use(express.json());
app.use('/',jobsRouter);

app.use((req,res)=>{
    res.status(404).json({error:'not_found'});
});

const port = process.env.PORT ?? 3000;

app.listen(port,()=>{
    console.log(`API listening on :${port}`);
});
