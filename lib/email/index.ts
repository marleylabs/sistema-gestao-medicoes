export type { EmailEvent, SendTransactionalEmailResult } from "@/lib/email/types";
export { sendTransactionalEmail } from "@/lib/email/send-email";
export {
  notifyPasswordReset,
  notifyBmAvailable,
  notifyBmDivergence,
  notifyBmApproved,
  notifyBmRevisionRequested,
  notifyPaymentReady,
  notifyPaymentCompleted,
} from "@/lib/email/events";
