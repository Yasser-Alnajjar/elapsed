import * as Yup from "yup";

export const signUpSchema = Yup.object({
  fullName: Yup.string(),
  organizationName: Yup.string().required("Organization name is required"),
  email: Yup.string()
    .email("Please enter a valid email address")
    .required("Email is required"),
  password: Yup.string()
    .min(8, "Password must be at least 8 characters")
    .required("Password is required"),
  acceptedTerms: Yup.boolean().oneOf(
    [true],
    "You must accept the terms to continue",
  ),
});

export type SignUpFormValues = Yup.InferType<typeof signUpSchema>;
