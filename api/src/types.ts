export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';
export interface Job{
    id: string;
    job_type: string;
    payload: Record<string,unknown>;
    status: JobStatus;
    attempts: number;
    max_attempt:number;
    result: Record<string,unknown> | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
}