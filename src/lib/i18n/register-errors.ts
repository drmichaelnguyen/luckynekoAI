import type { MessageKey } from "./messages";

/** Server action returns this key; client maps to `MessageKey` for `t()`. */
export type RegisterErrorKey =
  | "validation_email"
  | "validation_password"
  | "validation_default"
  | "auth_secret_missing"
  | "duplicate_email"
  | "create_failed"
  | "signin_autocreate_failed"
  | "signin_manual";

export const registerErrorMessageKey: Record<RegisterErrorKey, MessageKey> = {
  validation_email: "register_err_validation_email",
  validation_password: "register_err_validation_password",
  validation_default: "register_err_validation_default",
  auth_secret_missing: "register_err_auth_secret_missing",
  duplicate_email: "register_err_duplicate_email",
  create_failed: "register_err_create_failed",
  signin_autocreate_failed: "register_err_signin_autocreate_failed",
  signin_manual: "register_err_signin_manual",
};
