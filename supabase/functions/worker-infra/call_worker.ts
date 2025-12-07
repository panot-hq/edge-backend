import { Job, JOB_STATUS } from "./types.ts";
import {
  claim_next_job,
  get_remaining_jobs,
  update_job_status,
} from "./lib/helpers.ts";

export const call_worker = async (worker: Job) => {
  let remaining_jobs = await get_remaining_jobs(worker.user_id) || 0;

  if (remaining_jobs === 0) {
    return { error: "No remaining jobs" };
  }

  let job: Job | null = null;
  do {
    try {
      job = await claim_next_job(worker.user_id);
      if (!job) {
        throw new Error("No job found");
      }

      if (job.job_type === "DETAILS_UPDATE") {
        // perform details update
      } else if (job.job_type === "INTERACTION_TRANSCRIPT") {
        // perform interaction transcript
      } else { // NEW_CONTACT
        // perform new contact
      }

      update_job_status(job.id, JOB_STATUS.COMPLETED);
      remaining_jobs = await get_remaining_jobs(worker.user_id) || 0;
    } catch (error) {
      update_job_status(job?.id || "", JOB_STATUS.FAILED);
      console.error("Error claiming job:", error);
    }
  } while (remaining_jobs > 0);

  return { success: true };
};
