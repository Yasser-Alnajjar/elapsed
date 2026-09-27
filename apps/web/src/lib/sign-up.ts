import { z } from "zod";

export const signUpSchema = z.object({
  organizationName: z.string().trim().min(1, "Organization name is required").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().trim().max(200).optional(),
  acceptedTerms: z.boolean().optional(),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
