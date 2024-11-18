import React, { useRef, useState, useEffect } from 'react';
import { connectToSignalingServer } from './signaling';
import { getFile, getAllFiles, addFile } from './db'

const StringTransfer = () => {
    const peerConnection = useRef(null);
    const dataChannel = useRef(null);
    const signalingServer = useRef(null);

    const [connected, setConnected] = useState(false);
    //const [receivedMessages, setReceivedMessages] = useState([]);
    //const [messageToSend, setMessageToSend] = useState('');
    const [storedVideos, setStoredVideos] = useState([]);
    const [selectedVideoId, setSelectedVideoId] = useState(null);
    const [receivedVideoId, setReceivedVideoId] = useState(null); 
    const [isConnectedToSignaling, setIsConnectedToSignaling] = useState(false);
    const [connectionMessage, setConnectionMessage] = useState('');

    const configuration = {
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    };

    useEffect(() => {
        const fetchVideos = async () => {
            const videos = await getAllFiles();
            setStoredVideos(videos);
        };

        fetchVideos();
    }, []);

    const setupConnection = () => {
        peerConnection.current = new RTCPeerConnection(configuration);

        // Create a DataChannel for sending strings
        dataChannel.current = peerConnection.current.createDataChannel('stringTransfer');
        dataChannel.current.onopen = () => {
            console.log('DataChannel opened');
            setConnected(true);
        }
        dataChannel.current.onclose = () => console.log('DataChannel closed');
        dataChannel.current.onmessage = async (event) => {
            console.log('Received data:', event.data);

            // If the data is a string, check for metadata (end-of-file signal)
            if (typeof event.data === 'string') {
                try {
                const message = JSON.parse(event.data);
                if (message.type === 'end-of-file') {
                    console.log('End-of-file signal received:', message);

                    // Reconstruct the file from chunks
                    const blob = new Blob(window.receivedChunks);
                    const videoFile = new File([blob], message.fileName, { type: message.fileType });
                    const newVideoId = await addFile(videoFile); // Save to IndexedDB
                    setReceivedVideoId(newVideoId);

                    console.log('File transfer complete and saved to IndexedDB.');
                    window.receivedChunks = []; // Clear chunks
                }
                } catch (e) {
                    console.error('Error parsing message:', e);
                }
            } else {
                // Otherwise, treat the data as a chunk and store it
                if (!window.receivedChunks) {
                window.receivedChunks = []; // Initialize chunk storage
                }
                window.receivedChunks.push(event.data);
            }
        };


        // Handle ICE candidates
        peerConnection.current.onicecandidate = (event) => {
        if (event.candidate) {
            signalingServer.current.send(
                JSON.stringify({ type: 'ice-candidate', candidate: event.candidate })
            );
        }
        };

        peerConnection.current.ondatachannel = (event) => {
            dataChannel.current = event.channel;
            dataChannel.current.onmessage = async (e) => {
                console.log('Received2:', e.data);

                const blob = new Blob([e.data]);
                const videoFile = new File([blob], 'received_video.mp4', { type: 'video/mp4' });
                const newVideoId = await addFile(videoFile);
                setReceivedVideoId(newVideoId);
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

    const handleSignalingMessage = async (data) => {
        try {
            if (data.type === 'offer') {
                if (peerConnection.current.signalingState !== 'stable') {
                    console.warn('PeerConnection is not stable. Cannot set offer.');
                    return;
                }

                console.log('Received offer:', data.offer);
                await peerConnection.current.setRemoteDescription(
                    new RTCSessionDescription(data.offer)
                );
                const answer = await peerConnection.current.createAnswer();
                await peerConnection.current.setLocalDescription(answer);
                signalingServer.current.send(
                    JSON.stringify({ type: 'answer', answer })
                );
                console.log('Sent answer:', answer);

            } else if (data.type === 'answer') {
                if (peerConnection.current.signalingState !== 'have-local-offer') {
                    console.warn('PeerConnection is not in "have-local-offer" state. Cannot set answer.');
                    return;
                }

                console.log('Received answer:', data.answer);
                await peerConnection.current.setRemoteDescription(
                    new RTCSessionDescription(data.answer)
                );
            } else if (data.type === 'ice-candidate') {
                if (data.candidate) {
                    console.log('Adding ICE candidate:', data.candidate);
                    await peerConnection.current.addIceCandidate(data.candidate);
                }
            } else {
                console.warn('Unknown signaling message type:', data.type);
            }
        } catch (error) {
            console.error('Error handling signaling message:', error);
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

    const sendVideo = async () => {
        if (!selectedVideoId) {
            alert('Please select a video to send.');
            return;
        }

        const videoFile = await getFile(selectedVideoId); // Retrieve the video from IndexedDB
        if (!videoFile) {
            alert('Failed to retrieve video. Please try again.');
            return;
        }

        const CHUNK_SIZE = 16 * 1024; // 16 KB per chunk
        const reader = new FileReader();
        const arrayBuffer = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(videoFile.data); // Read the video file as an ArrayBuffer
        });

        const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
        let currentChunk = 0;

        const sendChunk = () => {
            if (!dataChannel.current || dataChannel.current.readyState !== 'open') {
            console.error('DataChannel is not open.');
            return;
            }

            // Extract the current chunk
            const start = currentChunk * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
            const chunk = arrayBuffer.slice(start, end);

            // Send the chunk
            dataChannel.current.send(chunk);
            console.log(`Sent chunk ${currentChunk + 1}/${totalChunks}`);

            currentChunk++;

            // Schedule the next chunk if there are more to send
            if (currentChunk < totalChunks) {
            setTimeout(sendChunk, 10); // Adjust timeout as needed
            } else {
            // Send "end-of-file" signal after all chunks are sent
            const metadata = {
                type: 'end-of-file',
                fileName: videoFile.fileName,
                fileType: videoFile.fileType,
            };
            dataChannel.current.send(JSON.stringify(metadata));
            console.log('File transfer complete.');
            }
        };

        // Start sending the first chunk
        sendChunk();
    };



    return (
        <div>
            <h1>Video Transfer</h1>
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
                    <button onClick={sendVideo}>Send Selected Video</button>
                    <div>
                        <h3>Select a Video to Send</h3>
                        {storedVideos.length > 0 ? (
                            <select
                                value={selectedVideoId || ''}
                                onChange={(e) => setSelectedVideoId(Number(e.target.value))}
                            >
                            <option value="" disabled>Select a video</option>
                            {storedVideos.map((video) => (
                                <option key={video.id} value={video.id}>
                                {video.fileName}
                                </option>
                            ))}
                            </select>
                        ) : (
                            <p>No videos available. Upload one first!</p>
                        )}
                    </div>
                    <h3>Received Video</h3>
                    {receivedVideoId && (
                        <p>Video stored in IndexedDB with ID: {receivedVideoId}</p>
                    )}
                </div>
            )}
        </div>
    );
};

export default StringTransfer;
