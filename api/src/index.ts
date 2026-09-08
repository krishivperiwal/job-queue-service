import 'dotenv/config';
import express from 'express';
import jobsRouter from './routes/jobs';
import cors from 'cors';

const REQUIRED_ENV_VARS = ['AWS_REGION', 'SQS_QUEUE_URL', 'DATABASE_URL', 'REDIS_URL'] as const;
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name]?.trim());

if (missingEnvVars.length > 0) {
    console.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}

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
