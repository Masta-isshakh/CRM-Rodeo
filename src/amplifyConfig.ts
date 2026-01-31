// src/amplifyConfig.ts
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";

// IMPORTANT: configure once, and as early as possible
Amplify.configure(outputs);
