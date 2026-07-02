"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm, type SubmitHandler } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { ArrowLeft, Loader2, Eye, EyeOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"
import { PasswordStrength } from "@/components/ui/password-strength"
import { auth, db } from "@/lib/firebase"
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth"
import { doc, setDoc } from "firebase/firestore"

const passwordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .regex(/[A-Z]/, "Password must contain at least one uppercase letter.")
      .regex(/[a-z]/, "Password must contain at least one lowercase letter.")
      .regex(/[0-9]/, "Password must contain at least one number.")
      .regex(/[^A-Za-z0-9]/, "Password must contain at least one special character."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  })

type PasswordFormValues = z.infer<typeof passwordSchema>

export default function PasswordPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    const email = localStorage.getItem('userEmail');
    if (!email) {
        toast({ variant: 'destructive', title: 'Error', description: 'Email not found. Please go back.'});
        router.push('/onboarding/email-verification');
    } else {
        setUserEmail(email);
    }
  }, [router, toast]);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: {
        password: '',
        confirmPassword: ''
    }
  })

  const watchedPassword = watch("password")

  const onSubmit: SubmitHandler<PasswordFormValues> = async (data) => {
    if (!userEmail) {
        toast({ variant: 'destructive', title: 'Error', description: 'User email is missing.'});
        return;
    }
    setIsSubmitting(true)

    try {
      // 1. Create the real Firebase Auth account.
      // Firebase handles password hashing/storage securely — we never store the raw password ourselves.
      const userCredential = await createUserWithEmailAndPassword(auth, userEmail, data.password);
      const user = userCredential.user;

      const displayName = localStorage.getItem("userName") || 'New User';
      const photoURL = "https://i.ibb.co/W4PR2Pw2/Whats-App-Image-2025-07-09-at-11-21-29-ca10852e.jpg";

      // 2. Update the Auth profile (optional but nice for displayName/photoURL access via auth.currentUser)
      await updateProfile(user, { displayName, photoURL });

      // 3. Build the Firestore profile document using the REAL Firebase UID
      const userProfileData: { [key: string]: any } = {
        uid: user.uid,
        email: userEmail,
        displayName,
        photoURL,
        createdAt: new Date().toISOString(),
        trustedContacts: [],
      };

      const fieldsToGet = [
        { key: 'userCountry', dbKey: 'country' },
        { key: 'userPhone', dbKey: 'phone' },
        { key: 'userAge', dbKey: 'age' },
        { key: 'userAddress1', dbKey: 'address1' },
        { key: 'userAddress2', dbKey: 'address2' },
        { key: 'userAddress3', dbKey: 'address3' },
        { key: 'userState', dbKey: 'state' },
        { key: 'userCity', dbKey: 'city' },
        { key: 'userNickname', dbKey: 'nickname' },
        { key: 'userAltPhone', dbKey: 'altPhone' },
      ];

      fieldsToGet.forEach(field => {
        const value = localStorage.getItem(field.key);
        if (value) {
          userProfileData[field.dbKey] = field.dbKey === 'age' ? Number(value) : value;
        }
      });

      // 4. Save the profile to Firestore under users/{uid} — matches your Firestore security rules pattern
      await setDoc(doc(db, "users", user.uid), userProfileData);

      // 5. Cache a bit of profile info locally for quick UI access (NOT the source of truth anymore)
      localStorage.setItem('femigo-user-profile', JSON.stringify(userProfileData));
      localStorage.setItem('userName', displayName);
      localStorage.setItem('femigo-is-logged-in', 'true');

      // 6. Clean up temporary onboarding data
      const lsKeysToClean = ['userEmail', 'userCountry', 'userPhone', 'userAge', 'userAddress1', 'userAddress2', 'userAddress3', 'userState', 'userCity', 'userNickname', 'userAltPhone', 'userPhotoDataUri', 'userAadhaarDataUri'];
      lsKeysToClean.forEach(key => localStorage.removeItem(key));

      router.push("/congratulations")

    } catch (error: any) {
      console.error("Account creation failed:", error)

      let description = "An unexpected error occurred. Please try again.";
      if (error.code === 'auth/email-already-in-use') {
        description = "An account with this email already exists. Please log in instead.";
      } else if (error.code === 'auth/weak-password') {
        description = "Password is too weak. Please choose a stronger password.";
      } else if (error.code === 'auth/invalid-email') {
        description = "The email address is invalid.";
      }

      toast({
        variant: "destructive",
        title: "Signup Failed",
        description,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden p-4 text-white bg-[#06010F]">
      <video
        src="https://videos.pexels.com/video-files/26621651/11977308_2560_1440_30fps.mp4"
        autoPlay
        muted
        loop
        playsInline
        className="absolute top-1/2 left-1/2 w-full h-full min-w-full min-h-full object-cover -translate-x-1/2 -translate-y-1/2 z-0 opacity-50"
      />
      <div className="absolute inset-0 z-10 bg-black/30" />

      <div className="relative z-20 w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-500">
        <div className="absolute top-0 left-0">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft />
          </Button>
        </div>

        <div className="mb-8 mt-16 px-4 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Set Your Password</h1>
          <p className="text-gray-400 mt-2 text-sm">
            This is the final step! Choose a strong, secure password.
          </p>
          <Progress value={(6 / 6) * 100} className="mt-4 h-2 bg-gray-700" />
        </div>

        <div className="w-full rounded-2xl border border-white/20 bg-black/50 p-8 shadow-2xl backdrop-blur-lg">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="password">Password</label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter your password"
                  {...register("password")}
                  className={errors.password ? "border-destructive pr-10" : "pr-10"}
                />
                 <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
                >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>

            <PasswordStrength password={watchedPassword} />

            <div className="space-y-2">
              <label htmlFor="confirmPassword">Confirm Password</label>
               <div className="relative">
                 <Input
                    id="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    {...register("confirmPassword")}
                    className={errors.confirmPassword ? "border-destructive pr-10" : "pr-10"}
                 />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
                >
                    {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
              )}
            </div>

            <Button type="submit" className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground py-3 text-lg" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="animate-spin" />
              ) : (
                "Create Account"
              )}
            </Button>
          </form>
        </div>
      </div>
    </main>
  )
}
