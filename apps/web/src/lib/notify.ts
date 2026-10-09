import { toast } from "sonner";

/**
 * The one way to show transient feedback (the result of an action). Persistent
 * page state goes in a dismissible `<Alert>`; destructive confirmations stay in
 * an AlertDialog. Messages are short, sentence case, and end with a period.
 *
 * Every toast carries a stable `id` (the message itself unless one is given),
 * so a repeat of the same message, e.g. from polling or a double click,
 * replaces the visible toast instead of stacking.
 */
type Options = { description?: string; id?: string | number };

export const notify = {
  success: (message: string, options: Options = {}) =>
    toast.success(message, { id: message, ...options }),
  error: (message: string, options: Options = {}) =>
    toast.error(message, { id: message, ...options }),
  warning: (message: string, options: Options = {}) =>
    toast.warning(message, { id: message, ...options }),
  info: (message: string, options: Options = {}) =>
    toast.info(message, { id: message, ...options }),
  /** Reports a `{ ok, message }` action result with the matching tone. */
  result: (result: { ok: boolean; message: string }, options: Options = {}) =>
    result.ok ? notify.success(result.message, options) : notify.error(result.message, options),
};
