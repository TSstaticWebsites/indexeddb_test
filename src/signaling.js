const signalingServerUrl = process.env.REACT_APP_SIGNALING_SERVER;

const connectToSignalingServer = (onMessage) => {
    const signalingServer = new WebSocket('wss://164.92.163.217'); // No options here

    signalingServer.onmessage = async (event) => {
        let message;

        if (event.data instanceof Blob) {
            // Convert Blob to string
            const text = await event.data.text();
            message = JSON.parse(text);
            console.log('received from signal server:', message)
        } else {
            // Directly parse if it's already a string
            message = JSON.parse(event.data);
            console.log('received from signal server:', message)
        }

        if (onMessage) onMessage(message);
    };

    return signalingServer;
};

export { connectToSignalingServer };