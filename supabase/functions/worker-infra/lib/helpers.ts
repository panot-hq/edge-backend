import { supabase } from "./supabase.ts";
import { Job, JOB_STATUS } from "../types.ts";

const update_job_status = async (job_id: string, status: string) => {
  const { error } = await supabase
    .from("process_queue")
    .update({ status })
    .eq("id", job_id);

  if (error) {
    throw new Error(error.message);
  }
};

const claim_next_job = async (user_id: string) => {
  const { data: job, error } = await supabase
    .from("process_queue")
    .select("*")
    .eq("user_id", user_id)
    .eq("status", JOB_STATUS.PENDING)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  update_job_status(job.id, JOB_STATUS.PROCESSING);
  return job as Job;
};

const get_remaining_jobs = async (user_id: string) => {
  const { count, error } = await supabase
    .from("process_queue")
    .select("*", { count: "exact", head: true })
    .eq("user_id", user_id)
    .eq("status", JOB_STATUS.PENDING);

  if (error) {
    throw new Error(error.message);
  }

  return count;
};

const get_user_worker = async (user_id: string) => {
  const { data: worker, error: workerError } = await supabase
    .from("workers")
    .select("*")
    .eq("user_id", user_id)
    .single();

  if (workerError) {
    throw new Error(workerError.message);
  }

  return worker;
};

export {
  claim_next_job,
  get_remaining_jobs,
  get_user_worker,
  update_job_status,
};
