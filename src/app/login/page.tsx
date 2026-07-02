"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, Lock, Mail, Loader2, Eye, EyeOff } from "lucide-react"
import Link from "next/link"
import { useForm } from "react-hook-form"
import { z } from "zod"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { auth, db } from "@/lib/firebase"
import { signInWithEmailAndPassword } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"

const formSchema = z.object({
  email: z.string().email({
    message: "Please enter a valid email.",
  }),
  password: z.string().min(1, {
    message: "Password is required.",
  }),
})

export default function LoginPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsSubmitting(true)
    try {
      // 1. Authenticate with real Firebase Auth
      const userCredential = await signInWithEmailAndPassword(auth, values.email, values.password);
      const user = userCredential.user;

      // 2. Fetch the user's profile document from Firestore
      const userDocRef = doc(db, "users", user.uid);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        toast({
          variant: "destructive",
          title: "Login Failed",
          description: "Account data not found. Please contact support.",
        });
        setIsSubmitting(false);
        return;
      }

      const userProfile = userDocSnap.data();

      // 3. Cache profile locally for quick UI access (not the source of truth)
      localStorage.setItem('femigo-user-profile', JSON.stringify(userProfile));
      localStorage.setItem('userName', userProfile.displayName || 'User');
      localStorage.setItem('femigo-is-logged-in', 'true');

      toast({
        title: "Logged In!",
        description: "Welcome back. Redirecting to your dashboard...",
      })
      router.push("/dashboard")

    } catch (error: any) {
      console.error("Login error:", error)

      let description = "An unexpected error occurred. Please try again.";
      if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password' || error.code === 'auth/user-not-found') {
        description = "Invalid email or password. Please check your credentials and try again.";
      } else if (error.code === 'auth/too-many-requests') {
        description = "Too many failed attempts. Please try again later.";
      }

      toast({
        variant: "destructive",
        title: "Login Failed",
        description,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-[#06010F] p-4 text-white">
      <video
        src="https://media.istockphoto.com/id/1456520455/nl/video/sulfur-cosmos-flowers-bloom-in-the-garden.mp4?s=mp4-480x480-is&k=20&c=xbZAFUX4xgFK_GWD71mYxPUwCZr-qTb9wObCrWMB8ak="
        autoPlay
        muted
        loop
        playsInline
        className="absolute top-1/2 left-1/2 w-full h-full min-w-full min-h-full object-cover -translate-x-1/2 -translate-y-1/2 z-0 opacity-70"
      />
      <div className="absolute inset-0 z-10 bg-gradient-to-t from-[#06010F] via-[#06010F]/60 to-transparent" />

      <div className="absolute top-8 left-8 z-20">
          <Link href="/" className="flex items-center gap-2 text-sm text-gray-300 transition-colors hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            Back to Home
          </Link>
      </div>

      <div className="relative z-20 w-full max-w-sm animate-in fade-in-0 zoom-in-95 duration-500">
        <div className="w-full rounded-2xl border border-white/20 bg-black/50 p-8 shadow-2xl backdrop-blur-lg">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-tight">Welcome Back</h1>
            <p className="text-gray-400 mt-2 text-sm">
              Log in to continue your journey with Femigo.
            </p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-6">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        placeholder="your.email@example.com"
                        {...field}
                        className={cn("pl-9", form.formState.errors.email && "border-destructive")}
                        disabled={isSubmitting}
                      />
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        type={showPassword ? "text" : "password"}
                        placeholder="Your Password"
                        {...field}
                        className={cn("pl-9 pr-10", form.formState.errors.password && "border-destructive")}
                        disabled={isSubmitting}
                      />
                      <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-white"
                          aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                          {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                      </button>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-gradient-to-r from-primary to-secondary text-primary-foreground py-3 text-lg"
              >
                {isSubmitting && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                Log In
              </Button>
            </form>
          </Form>

          <p className="pt-6 text-center text-sm text-gray-400">
            Don't have an account?{" "}
            <Link
              href="/signup"
              className="font-semibold text-primary hover:underline"
            >
              Sign Up
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
