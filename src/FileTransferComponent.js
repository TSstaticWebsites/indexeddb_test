import React, { useRef, useState } from 'react';
import { connectToSignalingServer } from './signaling';

const StringTransfer = () => {
  const peerConnection = useRef(null);
  const dataChannel = useRef(null);
  const signalingServer = useRef(null);

  const [connected, setConnected] = useState(false);
  const [receivedMessages, setReceivedMessages] = useState([]);
  const [messageToSend, setMessageToSend] = useState('');
  const [isConnectedToSignaling, setIsConnectedToSignaling] = useState(false);
  const [connectionMessage, setConnectionMessage] = useState('');

  const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
  };

  // Setup peer connection and data channel
  const setupConnection = () => {
    peerConnection.current = new RTCPeerConnection(configuration);

    // Create a DataChannel for sending strings
    dataChannel.current = peerConnection.current.createDataChannel('stringTransfer');
    dataChannel.current.onopen = () => {
        console.log('DataChannel opened');
        setConnected(true);
    }
    dataChannel.current.onclose = () => console.log('DataChannel closed');
    dataChannel.current.onmessage = (event) => {
      console.log('Received:', event.data);
      setReceivedMessages((prevMessages) => [...prevMessages, event.data]);
    };

    // Handle ICE candidates
    peerConnection.current.onicecandidate = (event) => {
      if (event.candidate) {
        signalingServer.current.send(
          JSON.stringify({ type: 'ice-candidate', candidate: event.candidate })
        );
      }
    };

    // Handle incoming data channel from remote peer
    peerConnection.current.ondatachannel = (event) => {
      dataChannel.current = event.channel;
      dataChannel.current.onmessage = (e) => {
        console.log('Received:', e.data);
        setReceivedMessages((prevMessages) => [...prevMessages, e.data]);
      };
    };

    // Connect to the signaling server
    signalingServer.current = connectToSignalingServer(handleSignalingMessage);

    signalingServer.current.onopen = () => {
        console.log('Connected to signaling server');
        setConnectionMessage('Successfully connected to the signaling server.');
        setIsConnectedToSignaling(true)
    };

    signalingServer.current.onclose = () => {
        console.log('Connection closed');
        setConnectionMessage('Disconnected from the signaling server.');
        setIsConnectedToSignaling(false)
    };

    signalingServer.current.onerror = (error) => {
        console.error('Signaling server error:', error);
        setConnectionMessage('Failed to connect to the signaling server. Please try again.');
        setIsConnectedToSignaling(false);
    };
  };

  // Handle signaling messages
  const handleSignalingMessage = async (data) => {
    if (data.type === 'offer') {
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(data.offer)
      );
      const answer = await peerConnection.current.createAnswer();
      await peerConnection.current.setLocalDescription(answer);
      signalingServer.current.send(
        JSON.stringify({ type: 'answer', answer })
      );
    } else if (data.type === 'answer') {
      await peerConnection.current.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );
    } else if (data.type === 'ice-candidate') {
      if (data.candidate) {
        await peerConnection.current.addIceCandidate(data.candidate);
      }
    }
  };

  // Create and send an SDP offer
  const createOffer = async () => {
    const offer = await peerConnection.current.createOffer();
    await peerConnection.current.setLocalDescription(offer);
    const message = JSON.stringify({ type: 'offer', offer })
    signalingServer.current.send(message);
    console.log('SDP offer create:', message)
  };

  // Send a string to the peer
  const sendMessage = () => {
    if (dataChannel.current && dataChannel.current.readyState === 'open') {
      dataChannel.current.send(messageToSend);
      console.log('Sent:', messageToSend);
      setMessageToSend(''); // Clear the input field
    }
  };

  return (
    <div>
      <h1>String Transfer</h1>
      {!connected ? (
        <>
            <button onClick={setupConnection} disabled={isConnectedToSignaling}>Start Connection</button>
            {isConnectedToSignaling ? (
                <button onClick={createOffer}>Connect</button>
            ): <></>}
            <p>{connectionMessage}</p> 
        </>
      ) : (
        <div>
            <p>Connected to a Peer</p> 
            <input
                type="text"
                value={messageToSend}
                onChange={(e) => setMessageToSend(e.target.value)}
                placeholder="Type your message here"
            />
            <button onClick={sendMessage}>Send</button>
            <h3>Received Messages:</h3>
            <ul>
                {receivedMessages.map((msg, index) => (
                <li key={index}>{msg}</li>
                ))}
            </ul>
        </div>
      )}
    </div>
  );
};

export default StringTransfer;
