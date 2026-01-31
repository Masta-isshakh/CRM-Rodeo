// src/amplifyConfig.ts
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

// Configure Amplify BEFORE any Auth/Data usage.
// (AWS examples configure first, then generateClient). 
Amplify.configure(outputs, { ssr: false });
