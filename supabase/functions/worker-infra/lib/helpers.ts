import { supabase } from "./supabase.ts";
import { Job, JOB_STATUS } from "../types.ts";

const get_contact_node_id = async (contact_id: string) => {
  const { data: node_id, error } = await supabase
    .from("contacts")
    .select("node_id")
    .eq("id", contact_id)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return node_id;
};

const update_interaction_to_processed = async (interaction_id: string) => {
  const { error } = await supabase
    .from("interactions")
    .update({ processed: true })
    .eq("id", interaction_id);

  if (error) {
    throw new Error(error.message);
  }
};

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

const details_update = async (job: Job) => {
  const node_id = await get_contact_node_id(job.contact_id);

  const { data, error } = await supabase.functions.invoke("relational-agent", {
    body: {
      transcript: job.payload.transcript,
      mode: "CONTACT_DETAILS_UPDATE",
      user_id: job.user_id,
      contact_id: job.contact_id,
      node_id: node_id,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

const interaction_transcript = async (job: Job) => {
  const node_id = await get_contact_node_id(job.contact_id);

  const { data, error } = await supabase.functions.invoke("relational-agent", {
    body: {
      transcript: job.payload.transcript,
      mode: "ACTIONABLE",
      user_id: job.user_id,
      contact_id: job.contact_id,
      node_id: node_id,
    },
  });

  if (error) {
    throw new Error(error.message);
  }
  if (job.payload.interaction_id) {
    update_interaction_to_processed(job.payload.interaction_id);
  }
  return data;
};

const new_contact = async (job: Job) => {
  if (job.contact_id) { // created manually
    const node_id = await get_contact_node_id(job.contact_id);

    const { data, error } = await supabase.functions.invoke(
      "relational-agent",
      {
        body: {
          transcript: job.payload.details,
          mode: "ACTIONABLE",
          user_id: job.user_id,
          contact_id: job.contact_id,
          node_id: node_id,
        },
      },
    );

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  // created with talk about them
  const { data, error } = await supabase.functions.invoke("relational-agent", {
    body: {
      transcript: job.payload.details,
      mode: "ACTIONABLE",
      user_id: job.user_id,
    },
  });

  if (error) {
    throw new Error(error.message);
  }

  return data;
};

export {
  claim_next_job,
  details_update,
  get_remaining_jobs,
  get_user_worker,
  interaction_transcript,
  new_contact,
  update_job_status,
};
