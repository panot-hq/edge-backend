export type Job = {
  id: string;
  user_id: string;
  contact_id: string;
  job_type: JOB_TYPE;
  payload: {
    details: string | null;
    transcript: string | null;
    interaction_id: string | null;
  };
  status: string;
  error_message: string;
  updated_at: Date;
  created_at: Date;
  processed_at: Date;
};

export const JOB_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  CANCELED: "canceled",
  FAILED: "failed",
};

export type JOB_TYPE =
  | "DETAILS_UPDATE"
  | "INTERACTION_TRANSCRIPT"
  | "NEW_CONTACT";
