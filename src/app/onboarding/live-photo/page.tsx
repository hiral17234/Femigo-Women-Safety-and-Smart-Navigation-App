
"use client"

import { useState, useRef, useCallback, useEffect } from "react"
import { useRouter } from "next/navigation"
import Image from "next/image"
import { ArrowLeft, Loader2, Camera, CheckCircle, AlertTriangle, RefreshCw, User, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { genderCheck } from "@/ai/flows/gender-check-flow"
import { type GenderCheckOutput } from "@/ai/types"
import { cn } from "@/lib/utils"

type VerificationState = "idle" | "camera" | "preview" | "verifying" | "success" | "failed" | "error"

export default function LivePhotoPage() {
  const router = useRouter()
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [verificationState, setVerificationState] = useState<VerificationState>("camera")
  const [verificationResult, setVerificationResult] = useState<GenderCheckOutput | null>(null)
  
  const stopCamera = useCallback(() => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream
      stream.getTracks().forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
  }, [])
  
  const startCamera = useCallback(async () => {
    setVerificationState("camera")
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play() // This line is added to start the video playback
      }
    } catch (err) {
      console.error("Error accessing camera:", err)
      toast({
        variant: "destructive",
        title: "Camera Error",
        description: "Could not access the camera. Please check permissions.",
      })
      setVerificationState("idle")
    }
  }, [toast])

  useEffect(() => {
    // On page load, ensure we have the prerequisite data. If not, go back to start.
    const userName = localStorage.getItem("userName");
    if (!userName) {
        toast({
            title: "Something went wrong",
            description: "We need your name to continue. Please start over.",
            variant: "destructive",
        });
        router.push("/signup");
    } else {
        startCamera();
    }
    
    // Cleanup camera on unmount
    return () => {
        stopCamera();
    }
  }, [router, toast, startCamera, stopCamera]);


  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        toast({ variant: 'destructive', title: 'Camera not ready', description: 'Please wait a moment and try again.' })
        return
      }
      const canvas = canvasRef.current
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext("2d")
      if (context) {
        // Flip the image horizontally for a mirror effect
        context.translate(video.videoWidth, 0);
        context.scale(-1, 1);
        context.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
        const dataUrl = canvas.toDataURL("image/jpeg", 0.92)
        setImageDataUrl(dataUrl)
        setVerificationState("preview")
        stopCamera()
      }
    }
  }
  
  const handleRetake = () => {
    setImageDataUrl(null)
    setVerificationResult(null)
    startCamera()
  }

  const handleVerification = useCallback(async () => {
    if (!imageDataUrl) {
      toast({ variant: 'destructive', title: 'Error', description: 'No image captured.' });
      return;
    }

    setVerificationState("verifying")
    
    try {
      const result = await genderCheck({ photoDataUri: imageDataUrl });
      setVerificationResult(result);

      if (result.isFemale) {
        setVerificationState("success");
        localStorage.setItem("userPhotoDataUri", imageDataUrl); // Save photo to localStorage
        toast({ variant: 'success', title: 'Photo Verified!', description: result.reason });
        
        const country = localStorage.getItem('userCountry');
        // Conditionally route to Aadhaar verification for India
        if (country === 'india') {
            setTimeout(() => router.push('/onboarding/aadhaar-verification'), 2000);
        } else {
            setTimeout(() => router.push('/onboarding/phone-verification'), 2000);
        }

      } else {
        setVerificationState("failed");
        toast({ variant: 'destructive', title: 'Verification Failed', description: result.reason });
      }
    } catch (error: any) {
        console.error("Gender check flow failed:", error);
        setVerificationState("error");
        const errorMessage = error.message || 'An unexpected error occurred during verification.';
        setVerificationResult({ isFemale: false, reason: errorMessage });
        toast({
            variant: "destructive",
            title: "Verification Error",
            description: errorMessage,
        });
    }
  }, [imageDataUrl, router, toast]);
  
  const getDisplayContent = () => {
    switch (verificationState) {
        case 'verifying':
        case 'success':
        case 'failed':
        case 'error':
            return (
                <div className="flex flex-col items-center justify-center text-center p-8 h-full">
                    {verificationState === 'verifying' && <>
                        <Loader2 className="h-16 w-16 animate-spin text-primary" />
                        <h3 className="text-2xl font-bold mt-4">Verifying...</h3>
                        <p className="text-muted-foreground mt-2">Our AI is checking your photo. Please wait.</p>
                    </>}
                    {verificationState === 'success' && <>
                        <CheckCircle className="h-16 w-16 text-green-500" />
                        <h3 className="text-2xl font-bold mt-4">Verification Successful!</h3>
                        <p className="text-muted-foreground mt-2">Redirecting to the next step...</p>
                    </>}
                    {(verificationState === 'failed' || verificationState === 'error') && <>
                        <AlertTriangle className="h-16 w-16 text-red-500" />
                        <h3 className="text-2xl font-bold mt-4">Verification Failed</h3>
                        <p className="text-muted-foreground mt-2">{verificationResult?.reason}</p>
                        <Button onClick={handleRetake} className="mt-6">
                            <RefreshCw className="mr-2 h-4 w-4" /> Try Again
                        </Button>
                    </>}
                </div>
            )
        default:
            return (
                <div className="flex flex-col items-center justify-center h-full">
                    <div className={cn("relative w-full aspect-video rounded-lg bg-muted overflow-hidden flex items-center justify-center border-2 border-primary", verificationState === 'camera' && 'border-primary')}>
                       {verificationState === 'idle' && <Camera className="h-20 w-20 text-muted-foreground/50 opacity-50" />}
                       <video ref={videoRef} autoPlay playsInline muted className={cn("w-full h-full object-cover scale-x-[-1]", verificationState !== 'camera' && 'hidden')} />
                       <canvas ref={canvasRef} className="hidden" />
                       {imageDataUrl && verificationState === 'preview' && (
                           <Image src={imageDataUrl} alt="Captured live photo" layout="fill" objectFit="cover" />
                       )}
                   </div>
                   {verificationState === 'preview' ? (
                       <div className="flex gap-4 mt-6 w-full">
                           <Button onClick={handleRetake} variant="secondary" className="w-full">
                               <RefreshCw className="mr-2 h-4 w-4" /> Retake
                           </Button>
                           <Button onClick={handleVerification} className="w-full">
                               Looks Good
                           </Button>
                       </div>
                   ) : (
                       <Button onClick={verificationState === 'camera' ? capturePhoto : startCamera} size="lg" className="mt-6 w-full">
                           <Camera className="mr-2 h-5 w-5" />
                           {verificationState === 'camera' ? 'Take Photo' : 'Capture Photo'}
                       </Button>
                   )}
                   {verificationState === 'camera' && <Button onClick={() => setVerificationState('idle')} variant="link" className="mt-2 text-muted-foreground">Cancel</Button>}
                </div>
            )
    }
  }


  return (
    <main className="dark relative flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background p-4 text-white">
       <div className="absolute inset-x-0 top-0 h-1/2 w-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-900/40 via-blue-950/10 to-transparent" />
      
       <div className="absolute top-8 left-8 z-10">
          <Button onClick={() => router.push('/signup')} variant="ghost" className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <ArrowLeft className="h-4 w-4" />
            Back to Account Details
          </Button>
        </div>

      <div className="relative z-20 w-full max-w-md animate-in fade-in-0 zoom-in-95 duration-500">
        <Card className="w-full rounded-2xl bg-black/50 p-10 shadow-2xl backdrop-blur-lg">
            <div className="flex items-start gap-4">
                <User className="h-8 w-8 text-primary shrink-0 mt-1" />
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Step 2: Live Photo &<br/>Gender Check</h1>
                    <p className="text-muted-foreground mt-2 text-sm">
                        Please take a clear, live photo. We'll verify you're female to ensure our community is safe and authentic.
                    </p>
                    <p className="text-red-500 mt-2 text-sm font-semibold">
                        Please remove glasses for the photo.
                    </p>
                </div>
            </div>
            <div className="mt-6 min-h-[300px]">
                {getDisplayContent()}
            </div>
        </Card>
      </div>
    </main>
  )
}
