import React, { useRef, useState, useEffect } from 'react';
import { getFile, getAllFiles, addFile } from './db'
import './FileTransferComponent.css'

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const FileTransferComponent = ({ fetchStoredFiles }) => {
    const dataChannel = useRef(null)
    const peerConnection = useRef(null)
    const signalingServer = useRef(null);

    const [uploadProgress, setUploadProgress] = useState(0);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [connected, setConnected] = useState(false);
    const [storedVideos, setStoredVideos] = useState([]);
    const [selectedVideoId, setSelectedVideoId] = useState(null);
    const [receivedVideoId, setReceivedVideoId] = useState(null); 
    const [isConnectedToSignaling, setIsConnectedToSignaling] = useState(false);
    const [connectionMessage, setConnectionMessage] = useState('');

    useEffect(() => {
        const fetchVideos = async () => {
            const videos = await getAllFiles();
            setStoredVideos(videos);
        };

        fetchVideos();
    }, []);

    const sendToSignalingServer = (msg) => {
        signalingServer.current.send(msg)
    }

    const setupConnection = () => {
        // Initializes WebRTC Connection handling
        peerConnection.current = new RTCPeerConnection(configuration);
        dataChannel.current = peerConnection.current.createDataChannel('FileTransfer') 

        // Connect to the signaling server
        signalingServer.current = new WebSocket(process.env.REACT_APP_SIGNALING_SERVER); 

        setupSignalingServer()
        setupDataChannel()
        setupPeerDiscovery()
    };

    const setupPeerDiscovery = () => {
        // Ice Candidate Discovery. This function is called when the Signaling server has a candidate 
        // and sends it to the peer. Ths would trigger the ICE Candidate Discovery sending information
        // about on how to connect to the signaling Server that will forward it to the other peer.
        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate) {
                sendToSignalingServer(
                    JSON.stringify({ 
                        type: 'ice-candidate', 
                        candidate: event.candidate 
                    })
                );
            } else {
                console.log('ICE candidate gathering complete')
            }
        };

        peerConnection.current.ondatachannel = (event) => {
            console.log('New incoming DataChannel event');
            const receivingDataCh = event.channel;

            let receivedChunks = []; // Array to hold video chunks
            let totalChunks = 0; // Initialize totalChunks
            let metadata = null; // Metadata for the received file

            receivingDataCh.onopen = () => {
                console.log('Receiving DataChannel opened');
                setConnected(true);
            };

            receivingDataCh.onclose = () => {
                console.log('Receiving DataChannel closed');
                setConnected(false);
            };

            receivingDataCh.onmessage = async (event) => {
                if (typeof event.data === 'string') {
                    try {
                        const parsedData = JSON.parse(event.data);
                        if (parsedData.type === 'start-of-file') {
                            console.log('Received start-of-file signal:', parsedData);

                            totalChunks = parsedData.totalChunks; // Store total number of chunks
                            metadata = parsedData; // Store metadata for later use
                            setDownloadProgress(0); // Reset download progress
                        } else if (parsedData.type === 'end-of-file') {
                            console.log('Received end-of-file signal:', parsedData);

                            // Assemble the video from chunks
                            const blob = new Blob(receivedChunks, { type: metadata.fileType });

                            // Create a File object from the Blob
                            const file = new File([blob], metadata.fileName, { type: metadata.fileType });

                            console.log('File assembled:', file);

                            // Save the file to IndexedDB
                            const id = await addFile(file);

                            console.log(`File saved in IndexedDB with ID: ${id}`);
                            setReceivedVideoId(id);

                            // Clear received chunks
                            receivedChunks = [];
                            setDownloadProgress(100); // Mark download as complete
                            fetchStoredFiles();
                        } else {
                            console.log('Received unexpected string data:', parsedData);
                        }
                    } catch (error) {
                        console.error('Failed to parse message as JSON:', error);
                    }
                } else {
                    // Add the binary chunk to the receivedChunks array
                    receivedChunks.push(event.data);

                    // Update download progress
                    const progress = Math.round((receivedChunks.length / totalChunks) * 100);
                    console.log(`Download progress: ${progress}%`);
                    setDownloadProgress(progress);
                }
            };
        };
    }

    const setupDataChannel = () => {
        // When a new data channel between the peers is established
        dataChannel.current.onopen = () => {
            console.log('DataChannel opened');
            setConnected(true);
        }
        
        // When the data channel gets closed
        dataChannel.current.onclose = () => {
            console.log('DataChannel closed');
            setConnected(false);
        }
    }

    const setupSignalingServer = () => {
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

        signalingServer.current.onmessage = async (event) => {
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
            // handle the Message that we got from the Signaling server
            try {
                if (message.type === 'offer') {
                    signalServerOfferHandling(message)
                } else if (message.type === 'answer') {
                    signalServerAnswerHandling(message)
                } else if (message.type === 'ice-candidate') {
                    signalServerIceHandling(message)
                } else {
                    console.warn('Unknown signaling message type:', message.type);
                }
            } catch (error) {
                console.error('Error handling signaling message:', error);
            }
        };
    }

    // This function handles SDP offers and creates an answer
    const signalServerOfferHandling = async (data) => {
        if (peerConnection.current.signalingState !== 'stable') {
            console.warn('PeerConnection is not stable. Cannot set offer.');
            return;
        }

        console.log('Received offer:', data.offer);

        // This function sets the other peers SDP. Meaning the Protocols and Paths on how the 
        // connection is done and handled
        await peerConnection.current.setRemoteDescription(
            new RTCSessionDescription(data.offer)
        );
    
        // Creates an answer if the offer is accepted
        const answer = await peerConnection.current.createAnswer();

        // We set the terms here for us
        await peerConnection.current.setLocalDescription(answer);

        // We send the other peer the answer 
        signalingServer.current.send(
            JSON.stringify({ type: 'answer', answer })
        );
        console.log('Sent answer:', answer);
    }

    // This function handles the SDP answer from another peer 
    const signalServerAnswerHandling = async (data) => {
        if (peerConnection.current.signalingState !== 'have-local-offer') {
            console.warn('PeerConnection is not in "have-local-offer" state. Cannot set answer.');
            return;
        }

        console.log('Received answer:', data.answer);
        await peerConnection.current.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );
    }

    const signalServerIceHandling = async (data) => {
        if (data.candidate) {
            console.log('Adding ICE candidate:', data.candidate);
            await peerConnection.current.addIceCandidate(data.candidate);
        }
    }

    // Create and send an SDP offer
    const createOffer = async () => {
        // Create an SDP offer and set it locally
        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);

        // send the offer to the signaling server, which will forward it to the other peer
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


        // Send start-of-file metadata
        const startMetadata = {
            type: 'start-of-file',
            fileName: videoFile.fileName,
            fileType: videoFile.fileType,
            totalChunks: totalChunks,
            fileSize: arrayBuffer.byteLength,
        };
        dataChannel.current.send(JSON.stringify(startMetadata));
        console.log('Sent start-of-file signal:', startMetadata);

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
            currentChunk++;

            // Update upload progress
            const progress = Math.round((currentChunk / totalChunks) * 100);
            console.log(`Upload progress: ${progress}%`);
            setUploadProgress(progress);

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
        <div className="video-transfer-container">
        <h1>Video Transfer</h1>

        {!connected ? (
            <div className="connection-controls">
                <button onClick={setupConnection} disabled={isConnectedToSignaling}>
                    Start Connection
                </button>
                {isConnectedToSignaling && (
                    <button onClick={createOffer}>Connect</button>
                )}
                <p>{connectionMessage}</p>
            </div>
        ) : (
            <div className="transfer-controls">
                <p>Connected to a Peer</p>

                <div className="video-selection">
                    <h3>Select a Video to Send</h3>
                    {storedVideos.length > 0 ? (
                        <div className="dropdown-container">
                            <select
                                value={selectedVideoId || ''}
                                onChange={(e) => setSelectedVideoId(Number(e.target.value))}
                            >
                                <option value="" disabled>
                                    Select a video
                                </option>
                                {storedVideos.map((video) => (
                                    <option key={video.id} value={video.id}>
                                        {video.fileName}
                                    </option>
                                ))}
                            </select>
                            <button className="send-video-btn" onClick={sendVideo}>
                                Send Selected Video
                            </button>
                        </div>
                    ) : (
                        <p>No videos available. Upload one first!</p>
                    )}
                </div>

                <div className="received-video">
                    <h3>Received Video</h3>
                    {receivedVideoId ? (
                        <p>Video stored in IndexedDB with ID: {receivedVideoId}</p>
                    ) : (
                        <p>No video received yet.</p>
                    )}
                </div>

                <div className="progress-section">
                    {uploadProgress >= 1 && uploadProgress < 100 && (
                        <div className="upload-progress">
                            <h3>Upload Progress</h3>
                            <progress value={uploadProgress} max="100"></progress>
                            <p>{uploadProgress}%</p>
                        </div>
                    )}
                    {uploadProgress === 100 && (
                        <p className="success-message">Upload completed successfully!</p>
                    )}

                    {downloadProgress >= 1 && downloadProgress < 100 && (
                        <div className="download-progress">
                            <h3>Download Progress</h3>
                            <progress value={downloadProgress} max="100"></progress>
                            <p>{downloadProgress}%</p>
                        </div>
                    )}
                    {downloadProgress === 100 && (
                        <p className="success-message">Download completed successfully!</p>
                    )}
                </div>
            </div>
        )}
        </div>

    );
};

export default FileTransferComponent;
