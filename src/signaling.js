const signalingServerUrl = process.env.REACT_APP_SIGNALING_SERVER;

const connectToSignalingServer = (onMessage) => {
  const signalingServer = new WebSocket('wss://164.92.163.217'); // No options here

  signalingServer.onopen = () => {
    console.log('Connected to signaling server');
  };

    signalingServer.onmessage = async (event) => {
        let message;

        if (event.data instanceof Blob) {
            // Convert Blob to string
            const text = await event.data.text();
            message = JSON.parse(text);
        } else {
            // Directly parse if it's already a string
            message = JSON.parse(event.data);
        }

        if (onMessage) onMessage(message);
    };

  signalingServer.onerror = (error) => {
    console.error('Signaling server error:', error);
  };

  return signalingServer;
};

export { connectToSignalingServer };