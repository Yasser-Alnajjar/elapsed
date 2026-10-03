"use client";

import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Formik, Form, FormikHelpers } from "formik";
import { Actions } from "@/actions/client";
import { AuthAlert, AuthPage } from "@/components/shared/auth-shell";
import { IdentityFields } from "./IdentityFields";
import { NewPasswordField } from "./NewPasswordField";
import { SignUpFooter, SignUpIntro } from "./SignUpCardSections";
import { TermsField } from "./TermsField";
import { WorkspaceFields } from "./WorkspaceFields";
import { signUpSchema, type SignUpFormValues } from "./sign-up-schema";

const initialValues: SignUpFormValues = {
  fullName: "",
  organizationName: "",
  email: "",
  password: "",
  acceptedTerms: false,
};

export const SignUpForm = () => {
  const router = useRouter();

  async function handleSubmit(
    values: SignUpFormValues,
    { setSubmitting, setStatus }: FormikHelpers<SignUpFormValues>,
  ) {
    setStatus(undefined);

    const { ok, body } = await Actions.Auth.signUp({
      fullName: values.fullName,
      organizationName: values.organizationName,
      email: values.email,
      password: values.password,
      acceptedTerms: values.acceptedTerms,
    });

    if (!ok) {
      setStatus(body.error ?? "Something went wrong");
      setSubmitting(false);
      return;
    }

    const signInResult = await Actions.Auth.signIn(
      values.email,
      values.password,
    );

    setSubmitting(false);

    if (!signInResult.ok) {
      router.push("/sign-in");
      return;
    }

    router.push("/onboarding");
  }

  return (
    <AuthPage>
      <div className="relative z-10 mx-auto flex w-full max-w-4xl flex-col py-4">
        <div className="relative w-full">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-16 left-1/2 h-48 w-3/4 -translate-x-1/2 rounded-full bg-primary/10 blur-[90px]"
          />

          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-10 inset-e-10 size-64 rounded-full bg-primary/10 blur-[100px]"
          />

          <div className="relative z-10 w-full rounded-lg bg-background/95 p-4 shadow-2xl md:p-8">
            <SignUpIntro />

            <Formik
              initialValues={initialValues}
              validationSchema={signUpSchema}
              onSubmit={handleSubmit}
            >
              {({ isSubmitting, status }) => (
                <Form className="space-y-4">
                  <IdentityFields />

                  <WorkspaceFields />

                  <NewPasswordField />

                  <TermsField />

                  {status && (
                    <AuthAlert tone="danger" icon={<AlertCircle aria-hidden />}>
                      {status}
                    </AuthAlert>
                  )}

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="group flex w-full cursor-pointer items-center justify-center gap-2 rounded-[2px] bg-primary px-6 py-3.5 font-mono text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary-hover hover:shadow-primary/35 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting && (
                        <Loader2
                          aria-hidden
                          className="size-4.5 animate-spin"
                        />
                      )}

                      <span>
                        {isSubmitting
                          ? "Creating account…"
                          : "Initialize Organization Workspace"}
                      </span>

                      {!isSubmitting && (
                        <ArrowRight aria-hidden className="size-4.5" />
                      )}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>

            <SignUpFooter />
          </div>
        </div>
      </div>
    </AuthPage>
  );
};
