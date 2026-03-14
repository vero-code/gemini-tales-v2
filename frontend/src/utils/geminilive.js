/**
 * Gemini Live API Utilities
 * Based on multimodalLiveApi.ts - converted to JavaScript
 */

// Response type constants
const MultimodalLiveResponseType = {
  TEXT: "TEXT",
  AUDIO: "AUDIO",
  SETUP_COMPLETE: "SETUP COMPLETE",
  INTERRUPTED: "INTERRUPTED",
  TURN_COMPLETE: "TURN COMPLETE",
  TOOL_CALL: "TOOL_CALL",
  ERROR: "ERROR",
  INPUT_TRANSCRIPTION: "INPUT_TRANSCRIPTION",
  OUTPUT_TRANSCRIPTION: "OUTPUT_TRANSCRIPTION",
};

/**
 * Parses response messages from the Gemini Live API
 */
class MultimodalLiveResponseMessage {
  constructor(data) {
    this.data = "";
    this.type = "";
    this.endOfTurn = false;

    this.endOfTurn = data?.serverContent?.turnComplete;

    const parts = data?.serverContent?.modelTurn?.parts;

    try {
      if (data?.setupComplete) {
        this.type = MultimodalLiveResponseType.SETUP_COMPLETE;
      } else if (data?.serverContent?.turnComplete) {
        this.type = MultimodalLiveResponseType.TURN_COMPLETE;
      } else if (data?.serverContent?.interrupted) {
        this.type = MultimodalLiveResponseType.INTERRUPTED;
      } else if (data?.serverContent?.inputTranscription) {
        this.type = MultimodalLiveResponseType.INPUT_TRANSCRIPTION;
        this.data = {
          text: data.serverContent.inputTranscription.text || "",
          finished: data.serverContent.inputTranscription.finished || false,
        };
      } else if (data?.serverContent?.outputTranscription) {
        this.type = MultimodalLiveResponseType.OUTPUT_TRANSCRIPTION;
        this.data = {
          text: data.serverContent.outputTranscription.text || "",
          finished: data.serverContent.outputTranscription.finished || false,
        };
      } else if (data?.toolCall) {
        this.type = MultimodalLiveResponseType.TOOL_CALL;
        this.data = data?.toolCall;
      } else if (data?.error) {
        this.type = MultimodalLiveResponseType.ERROR;
        this.data = data.error;
      } else if (parts?.length && parts[0].text) {
        this.data = parts[0].text;
        this.type = MultimodalLiveResponseType.TEXT;
      } else if (parts?.length && parts[0].inlineData) {
        this.data = parts[0].inlineData.data;
        this.type = MultimodalLiveResponseType.AUDIO;
      }
    } catch {
      console.log("⚠️ Error parsing response data: ", data);
    }
  }
}

/**
 * Function call definition for tool use
 */
class FunctionCallDefinition {
  constructor(name, description, parameters, requiredParameters) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.requiredParameters = requiredParameters;
  }

  functionToCall(parameters) {
  }

  getDefinition() {
    const definition = {
      name: this.name,
      description: this.description,
      parameters: { required: this.requiredParameters, ...this.parameters },
    };
    return definition;
  }

  runFunction(parameters) {
    this.functionToCall(parameters);
  }
}

/**
 * Main Gemini Live API client
 */
class GeminiLiveAPI {
  constructor(proxyUrl, projectId, model) {
    this.proxyUrl = proxyUrl;
    this.projectId = projectId;
    this.model = model;
    this.modelUri = `projects/${this.projectId}/locations/us-central1/publishers/google/models/${this.model}`;

    this.responseModalities = [{ modality: "AUDIO" }];
    this.googleGrounding = false;
    this.enableAffectiveDialog = false; 
    this.temperature = 1.0; 
    this.proactivity = { proactiveAudio: false }; 
    this.inputAudioTranscription = false;
    this.outputAudioTranscription = false;
    this.enableFunctionCalls = false;
    this.functions = [];
    this.functionsMap = {};
    this.previousImage = null;
    this.totalBytesSent = 0;

    this.useADK = false;

    // Automatic activity detection settings with defaults
    this.automaticActivityDetection = {
      disabled: false,
      silence_duration_ms: 1500, // Reduced from 2000 for better responsiveness
      prefix_padding_ms: 500,
      // Removed unspecified sensitivity to let Google use defaults
    };

    this.activityHandling = null; // Don't send if not set

    this.apiHost = "us-central1-aiplatform.googleapis.com";
    this.serviceUrl = `wss://${this.apiHost}/ws/google.cloud.aiplatform.v1beta1.LlmBidiService/BidiGenerateContent`;

    this.connected = false;
    this.webSocket = null;
    this.lastSetupMessage = null; // Store the last setup message

    /** @type {(message: MultimodalLiveResponseMessage) => void} */
    this.onReceiveResponse = (message) => {
    };

    /** @type {() => void} */
    this.onConnectionStarted = () => {
    };

    /** @type {(error: any) => void} */
    this.onErrorMessage = (message) => {
      this.connected = false;
    };

    /** @type {() => void} */
    this.onClose = () => {
    };
  }

  setProjectId(projectId) {
    this.projectId = projectId;
    this.modelUri = `projects/${this.projectId}/locations/us-central1/publishers/google/models/${this.model}`;
  }

  formatResponseModalities(modalities) {
    return modalities.map(m => 
      typeof m === 'string' ? { modality: m } : m
    );
  }

  setSystemInstructions(newSystemInstructions) {
    this.systemInstructions = newSystemInstructions;
  }

  setGoogleGrounding(newGoogleGrounding) {
    this.googleGrounding = newGoogleGrounding;
  }

  setResponseModalities(modalities) {
    this.responseModalities = modalities;
  }

  setVoice(voiceName) {
    this.voiceName = voiceName;
  }

  setProactivity(proactivity) {
    this.proactivity = proactivity;
  }

  setInputAudioTranscription(enabled) {
    this.inputAudioTranscription = enabled;
  }

  setOutputAudioTranscription(enabled) {
    this.outputAudioTranscription = enabled;
  }

  setEnableFunctionCalls(enabled) {
    this.enableFunctionCalls = enabled;
  }

  addFunction(newFunction) {
    this.functions.push(newFunction);
    this.functionsMap[newFunction.name] = newFunction;
  }

  callFunction(functionName, parameters) {
    const functionToCall = this.functionsMap[functionName];
    functionToCall.runFunction(parameters);
  }

  connect() {
    this.setupWebSocketToService();
  }

  disconnect() {
    if (this.webSocket) {
      this.webSocket.close();
      this.connected = false;
    }
  }

  sendMessage(message) {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
    }
  }

  onReceiveMessage(messageEvent) {
    const messageData = JSON.parse(messageEvent.data);
    const message = new MultimodalLiveResponseMessage(messageData);
    this.onReceiveResponse(message);
  }

  setupWebSocketToService() {
    this.webSocket = new WebSocket(this.proxyUrl);

    this.webSocket.onclose = (event) => {
      this.connected = false;
      this.onClose();
    };

    this.webSocket.onerror = (event) => {
      this.connected = false;
      this.onErrorMessage("Connection error");
    };

    this.webSocket.onopen = (event) => {
      this.connected = true;
      this.totalBytesSent = 0;

      if (!this.useADK) {
        this.sendInitialSetupMessages();
      }

      this.onConnectionStarted();
    };

    this.webSocket.onmessage = this.onReceiveMessage.bind(this);
  }

  getFunctionDefinitions() {
    const tools = [];

    for (let index = 0; index < this.functions.length; index++) {
      const func = this.functions[index];
      tools.push(func.getDefinition());
    }
    return tools;
  }

  sendInitialSetupMessages() {
    const serviceSetupMessage = {
      service_url: this.serviceUrl,
    };
    this.sendMessage(serviceSetupMessage);

    const tools = this.getFunctionDefinitions();

    const sessionSetupMessage = {
      setup: {
        model: this.modelUri,
        generation_config: {
          response_modalities: this.formatResponseModalities(this.responseModalities),
          temperature: this.temperature,
          speech_config: {
            voice_config: {
              prebuilt_voice_config: {
                voice_name: this.voiceName,
              },
            },
          },
        },
        system_instruction: { parts: [{ text: this.systemInstructions }] },
        tools: { function_declarations: tools },
        proactivity: this.proactivity,

        realtime_input_config: {
          automatic_activity_detection: this.automaticActivityDetection,
        },
      },
    };

    if (this.activityHandling) {
      sessionSetupMessage.setup.realtime_input_config.activity_handling = this.activityHandling;
    }

    // Add transcription config if enabled
    if (this.inputAudioTranscription) {
      sessionSetupMessage.setup.input_audio_transcription = {};
    }
    if (this.outputAudioTranscription) {
      sessionSetupMessage.setup.output_audio_transcription = {};
    }

    if (this.googleGrounding) {
      sessionSetupMessage.setup.tools.google_search = {};
      // Currently can't have both Google Search with custom tools.
      delete sessionSetupMessage.setup.tools.function_declarations;
    }

    // Add affective dialog if enabled
    if (this.enableAffectiveDialog) {
      sessionSetupMessage.setup.generation_config.enable_affective_dialog = true;
    }

    // Store the setup message for later access
    this.lastSetupMessage = sessionSetupMessage;

    this.sendMessage(sessionSetupMessage);
  }

  sendTextMessage(text) {
    const textMessage = {
      client_content: {
        turns: [
          {
            role: "user",
            parts: [{ text: text }],
          },
        ],
        turn_complete: true,
      },
    };
    this.sendMessage(textMessage);
  }

  sendToolResponse(toolCallId, response) {
    const message = {
      tool_response: {
        id: toolCallId,
        response: response,
      },
    };
    this.sendMessage(message);
  }

  sendRealtimeInputMessage(data, mime_type) {
    const message = this.useADK 
      ? {
          type: mime_type.includes("audio") ? "audio" : "image",
          data: data,
          mimeType: mime_type
        }
      : {
          realtime_input: {
            media_chunks: [
              {
                mime_type: mime_type,
                data: data,
              },
            ],
          },
        };
    this.sendMessage(message);
    this.addToBytesSent(data);
  }

  addToBytesSent(data) {
    const encoder = new TextEncoder();
    const encodedData = encoder.encode(data);
    this.totalBytesSent += encodedData.length;
  }

  getBytesSent() {
    return this.totalBytesSent;
  }

  sendAudioMessage(base64PCM) {
    this.sendRealtimeInputMessage(base64PCM, "audio/pcm;rate=16000");
  }

  async sendImageMessage(base64Image, mime_type = "image/jpeg") {
    this.sendRealtimeInputMessage(base64Image, mime_type);
  }
}

export { GeminiLiveAPI, FunctionCallDefinition, MultimodalLiveResponseType };