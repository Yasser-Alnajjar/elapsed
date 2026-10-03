import * as Yup from "yup";

export const resetPasswordSchema = Yup.object({
  password: Yup.string()
    .min(8, "Password must be at least 8 characters")
    .required("Password is required"),
  confirmPassword: Yup.string()
    .oneOf([Yup.ref("password")], "Passwords do not match")
    .required("Please confirm your password"),
});

export type ResetPasswordFormValues = Yup.InferType<typeof resetPasswordSchema>;

export const cardClass =
  "relative w-full overflow-hidden rounded-[8px] bg-background p-6 shadow-2xl md:p-8";
