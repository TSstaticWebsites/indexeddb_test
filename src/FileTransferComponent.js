import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { getFile, getAllFiles, addFile } from './db';
import { LayeredEncryption } from './lib/onion/crypto';
import { NodeRegistry } from './lib/onion/nodeRegistry';
import { CircuitBuilder, CircuitStatus } from './lib/onion/circuitBuilder';
import NodeControls from './components/NodeControls';
import './FileTransferComponent.css';

const configuration = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const FileTransferComponent = forwardRef(({ fetchStoredFiles }, ref) => {
    // Existing refs and state
    const dataChannel = useRef(null);
    const peerConnection = useRef(null);
    const signalingServer = useRef(null);

    // Onion routing refs
    const nodeRegistry = useRef(null);
    const circuitBuilder = useRef(null);
    const currentCircuit = useRef(null);
    const layeredEncryption = useRef(null);

    // Existing state
    const [uploadProgress, setUploadProgress] = useState(0);
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [connected, setConnected] = useState(false);
    const [storedVideos, setStoredVideos] = useState([]);
    const [selectedVideoId, setSelectedVideoId] = useState(null);
    const [receivedVideoId, setReceivedVideoId] = useState(null);
    const [isConnectedToSignaling, setIsConnectedToSignaling] = useState(false);
    const [connectionMessage, setConnectionMessage] = useState('');

    // New state for circuit status
    const [circuitStatus, setCircuitStatus] = useState(null);
    const [circuitHops, setCircuitHops] = useState(0);
    const [circuitMonitor, setCircuitMonitor] = useState(null);

    // New state for routing visualization
    const [currentRoutingChunk, setCurrentRoutingChunk] = useState(0);
    const [totalRoutingChunks, setTotalRoutingChunks] = useState(0);
    const [transferDirection, setTransferDirection] = useState('outbound');

    // Expose internal state via ref and handle state changes in a single effect
    useEffect(() => {
        if (!ref.current) return;

        // Update ref values
        ref.current.circuit = currentCircuit.current;
        ref.current.circuitBuilder = circuitBuilder.current;
        ref.current.nodeRegistry = nodeRegistry.current;
        ref.current.currentChunk = currentRoutingChunk;
        ref.current.totalChunks = totalRoutingChunks;
        ref.current.transferDirection = transferDirection;

        // Notify parent of state changes if callback exists
        if (ref.current.onStateChange) {
            ref.current.onStateChange({
                circuit: currentCircuit.current,
                circuitBuilder: circuitBuilder.current,
                nodeRegistry: nodeRegistry.current,
                currentChunk: currentRoutingChunk,
                totalChunks: totalRoutingChunks,
                transferDirection
            });
        }

        // Subscribe to node registry state changes
        const cleanup = nodeRegistry.current?.subscribe('stateChange', () => {
            if (ref.current?.onStateChange) {
                ref.current.onStateChange({
                    circuit: currentCircuit.current,
                    circuitBuilder: circuitBuilder.current,
                    nodeRegistry: nodeRegistry.current,
                    currentChunk: currentRoutingChunk,
                    totalChunks: totalRoutingChunks,
                    transferDirection
                });
            }
        });

        return () => cleanup?.();
    }, [currentRoutingChunk, totalRoutingChunks, transferDirection]);

    useEffect(() => {
        const fetchVideos = async () => {
            const videos = await getAllFiles();
            setStoredVideos(videos);
        };

        fetchVideos();
    }, []);

    const sendToSignalingServer = (msg) => {
        signalingServer.current.send(msg);
    };

    const setupConnection = async () => {
        try {
            setCircuitStatus(CircuitStatus.CONNECTING);
            setConnectionMessage('Initializing connection...');

            // Initialize onion routing components
            layeredEncryption.current = new LayeredEncryption();
            const nodeId = crypto.randomUUID();

            // Get base URL without trailing slash and ensure single /ws path
            const baseUrl = process.env.REACT_APP_SIGNALING_SERVER.replace(/\/ws\/?$/, '');
            const wsUrl = `${baseUrl}/ws/${nodeId}`;
            console.log('Connecting to WebSocket URL:', wsUrl);

            // Create WebSocket connection with proper event handlers
            signalingServer.current = new WebSocket(wsUrl);

            // Setup signaling server event handlers before attempting connection
            signalingServer.current.onopen = () => {
                console.log('WebSocket connection established');
                setConnectionMessage('Connected to signaling server. Registering as node...');
                setIsConnectedToSignaling(true);
            };

            signalingServer.current.onerror = (error) => {
                console.error('WebSocket connection error:', error);
                setConnectionMessage('Failed to connect to signaling server. Please check your connection and try again.');
                setCircuitStatus(CircuitStatus.FAILED);
                setIsConnectedToSignaling(false);
            };

            signalingServer.current.onclose = () => {
                console.log('WebSocket connection closed');
                setConnectionMessage('Disconnected from signaling server.');
                setCircuitStatus(CircuitStatus.FAILED);
                setIsConnectedToSignaling(false);
            };

            // Wait for WebSocket connection
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('WebSocket connection timeout'));
                    signalingServer.current?.close();
                }, 5000);

                const onOpen = () => {
                    clearTimeout(timeout);
                    resolve();
                };

                const onError = (error) => {
                    clearTimeout(timeout);
                    reject(error);
                };

                signalingServer.current.addEventListener('open', onOpen);
                signalingServer.current.addEventListener('error', onError);

                // Cleanup event listeners on timeout/error
                const cleanup = () => {
                    signalingServer.current?.removeEventListener('open', onOpen);
                    signalingServer.current?.removeEventListener('error', onError);
                };

                setTimeout(cleanup, 5000);
            });

            // Initialize components after WebSocket is connected
            nodeRegistry.current = new NodeRegistry(signalingServer.current);
            circuitBuilder.current = new CircuitBuilder(nodeRegistry.current, layeredEncryption.current);

            // Register as a relay node
            try {
                await nodeRegistry.current.registerAsNode(nodeId);
                setConnectionMessage('Registered as relay node. Building circuit...');
                setCircuitStatus(CircuitStatus.BUILDING);
            } catch (error) {
                console.warn('Node registration error:', error);
                setConnectionMessage(`Registration failed: ${error.message}`);
                setCircuitStatus(CircuitStatus.FAILED);
                throw error;
            }

            // PLACEHOLDER: Circuit building and WebRTC initialization code

        } catch (error) {
            console.error('Setup error:', error);
            setConnectionMessage(`Connection failed: ${error.message}`);
            setCircuitStatus(CircuitStatus.FAILED);
            signalingServer.current?.close();
        }
    };

    const setupPeerDiscovery = () => {
        peerConnection.current.onicecandidate = (event) => {
            if (event.candidate) {
                sendToSignalingServer(
                    JSON.stringify({
                        type: 'ice-candidate',
                        candidate: event.candidate
                    })
                );
            } else {
                console.log('ICE candidate gathering complete');
            }
        };

        peerConnection.current.ondatachannel = (event) => {
            console.log('New incoming DataChannel event');
            const receivingDataCh = event.channel;

            let receivedChunks = [];
            let totalChunks = 0;
            let metadata = null;

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

                            totalChunks = parsedData.totalChunks;
                            metadata = parsedData;
                            setDownloadProgress(0);
                        } else if (parsedData.type === 'end-of-file') {
                            console.log('Received end-of-file signal:', parsedData);

                            const blob = new Blob(receivedChunks, { type: metadata.fileType });
                            const file = new File([blob], metadata.fileName, { type: metadata.fileType });

                            console.log('File assembled:', file);

                            const id = await addFile(file);

                            console.log(`File saved in IndexedDB with ID: ${id}`);
                            setReceivedVideoId(id);

                            receivedChunks = [];
                            setDownloadProgress(100);
                            fetchStoredFiles();
                        } else {
                            console.log('Received unexpected string data:', parsedData);
                        }
                    } catch (error) {
                        console.error('Failed to parse message as JSON:', error);
                    }
                } else {
                    receivedChunks.push(event.data);

                    const progress = Math.round((receivedChunks.length / totalChunks) * 100);
                    console.log(`Download progress: ${progress}%`);
                    setDownloadProgress(progress);
                }
            };
        };
    };

    const setupDataChannel = () => {
        dataChannel.current.onopen = () => {
            console.log('DataChannel opened');
            setConnected(true);
        };

        dataChannel.current.onclose = () => {
            console.log('DataChannel closed');
            setConnected(false);
            if (currentCircuit.current) {
                circuitBuilder.current.closeCircuit(currentCircuit.current);
                setCircuitStatus(CircuitStatus.CLOSED);
            }
        };
    };

    const setupSignalingServer = () => {
        if (!signalingServer.current) {
            console.error('Signaling server not initialized');
            return;
        }

        signalingServer.current.onopen = () => {
            console.log('Connected to signaling server');
            setConnectionMessage('Successfully connected to the signaling server.');
            setIsConnectedToSignaling(true);
        };

        signalingServer.current.onclose = () => {
            console.log('Connection closed');
            setConnectionMessage('Disconnected from the signaling server.');
            setIsConnectedToSignaling(false);
        };

        signalingServer.current.onerror = (error) => {
            console.error('Signaling server error:', error);
            setConnectionMessage('Failed to connect to the signaling server. Please try again.');
            setIsConnectedToSignaling(false);
        };

        // Register WebRTC signaling handler with NodeRegistry
        nodeRegistry.current.registerWebRTCHandler(async (data) => {
            try {
                if (data.type === 'offer') {
                    await signalServerOfferHandling(data);
                } else if (data.type === 'answer') {
                    await signalServerAnswerHandling(data);
                } else if (data.type === 'ice-candidate') {
                    await signalServerIceHandling(data);
                } else {
                    console.warn('Unknown signaling message type:', data.type);
                }
            } catch (error) {
                console.error('Error handling signaling message:', error);
            }
        });

        // Register circuit handler for WebRTC messages
        nodeRegistry.current.registerCircuitHandler(async (data) => {
            if (data.type === 'webrtc') {
                const message = data.payload;
                try {
                    if (message.type === 'offer') {
                        await signalServerOfferHandling(message);
                    } else if (message.type === 'answer') {
                        await signalServerAnswerHandling(message);
                    } else if (message.type === 'ice-candidate') {
                        await signalServerIceHandling(message);
                    }
                } catch (error) {
                    console.error('Error handling circuit WebRTC message:', error);
                }
            }
        });
    };

    const signalServerOfferHandling = async (data) => {
        if (peerConnection.current.signalingState !== 'stable') {
            console.warn('PeerConnection is not stable. Cannot set offer.');
            return;
        }

        console.log('Received offer through circuit:', data.offer);

        await peerConnection.current.setRemoteDescription(
            new RTCSessionDescription(data.offer)
        );

        const answer = await peerConnection.current.createAnswer();
        await peerConnection.current.setLocalDescription(answer);

        // Send answer through circuit
        if (currentCircuit.current) {
            await circuitBuilder.current.sendThroughCircuit(
                currentCircuit.current,
                new TextEncoder().encode(JSON.stringify({
                    type: 'webrtc',
                    payload: { type: 'answer', answer }
                }))
            );
        }
        console.log('Sent answer through circuit:', answer);
    };

    const signalServerAnswerHandling = async (data) => {
        if (peerConnection.current.signalingState !== 'have-local-offer') {
            console.warn('PeerConnection is not in "have-local-offer" state. Cannot set answer.');
            return;
        }

        console.log('Received answer through circuit:', data.answer);
        await peerConnection.current.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );
    };

    const signalServerIceHandling = async (data) => {
        if (data.candidate) {
            console.log('Adding ICE candidate:', data.candidate);
            await peerConnection.current.addIceCandidate(data.candidate);
        }
    };

    const createOffer = async () => {
        const offer = await peerConnection.current.createOffer();
        await peerConnection.current.setLocalDescription(offer);

        // Send offer through circuit
        if (currentCircuit.current) {
            await circuitBuilder.current.sendThroughCircuit(
                currentCircuit.current,
                new TextEncoder().encode(JSON.stringify({
                    type: 'webrtc',
                    payload: { type: 'offer', offer }
                }))
            );
        }
        console.log('SDP offer sent through circuit:', offer);
    };

    const sendVideo = async () => {
        if (!selectedVideoId || !currentCircuit.current) {
            alert('Please select a video and ensure circuit is established.');
            return;
        }

        const videoFile = await getFile(selectedVideoId);
        if (!videoFile) {
            alert('Failed to retrieve video. Please try again.');
            return;
        }

        const CHUNK_SIZE = 16 * 1024;
        const MAX_BUFFERED_AMOUNT = 64 * 1024;

        const reader = new FileReader();
        const arrayBuffer = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(videoFile.data);
        });

        const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
        let currentChunk = 0;

        // Initialize routing visualization state
        setTotalRoutingChunks(totalChunks);
        setCurrentRoutingChunk(0);
        setTransferDirection('outbound');

        const startMetadata = {
            type: 'start-of-file',
            fileName: videoFile.fileName,
            fileType: videoFile.fileType,
            totalChunks: totalChunks,
            fileSize: arrayBuffer.byteLength,
        };

        await circuitBuilder.current.sendThroughCircuit(
            currentCircuit.current,
            new TextEncoder().encode(JSON.stringify(startMetadata))
        );

        const sendChunk = async () => {
            if (!currentCircuit.current || circuitBuilder.current.getCircuitStatus(currentCircuit.current) !== CircuitStatus.READY) {
                console.error('Circuit is not ready.');
                return;
            }

            if (dataChannel.current.bufferedAmount > MAX_BUFFERED_AMOUNT) {
                console.log('Buffer is full, waiting...');
                setTimeout(sendChunk, 10);
                return;
            }

            const start = currentChunk * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
            const chunk = arrayBuffer.slice(start, end);

            await circuitBuilder.current.sendThroughCircuit(currentCircuit.current, chunk);
            currentChunk++;

            // Update routing visualization state
            setCurrentRoutingChunk(currentChunk);
            const progress = Math.round((currentChunk / totalChunks) * 100);
            console.log(`Upload progress: ${progress}%`);
            setUploadProgress(progress);

            if (currentChunk < totalChunks) {
                setTimeout(sendChunk, 10);
            } else {
                const metadata = {
                    type: 'end-of-file',
                    fileName: videoFile.fileName,
                    fileType: videoFile.fileType,
                };
                await circuitBuilder.current.sendThroughCircuit(
                    currentCircuit.current,
                    new TextEncoder().encode(JSON.stringify(metadata))
                );
                console.log('File transfer complete.');
            }
        };

        sendChunk();
    };

    return (
        <div className="video-transfer-container">
            <h1>Anonymous Video Transfer</h1>

            {!connected ? (
                <div className="connection-controls">
                    <button onClick={setupConnection} disabled={isConnectedToSignaling}>
                        Start Anonymous Connection
                    </button>
                    {isConnectedToSignaling && circuitStatus === CircuitStatus.READY && (
                        <button onClick={createOffer}>Connect to Peer</button>
                    )}
                    <p>{connectionMessage}</p>
                    {circuitStatus && (
                        <div className="circuit-status">
                            <p>Circuit Status: {circuitStatus}</p>
                            {circuitStatus === CircuitStatus.READY && (
                                <p>Hops: {circuitHops}</p>
                            )}
                        </div>
                    )}
                    {isConnectedToSignaling && (
                        <NodeControls
                            circuit={currentCircuit.current}
                            circuitBuilder={circuitBuilder.current}
                            nodeRegistry={nodeRegistry.current}
                        />
                    )}
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

                    <NodeControls
                        circuit={currentCircuit.current}
                        circuitBuilder={circuitBuilder.current}
                        nodeRegistry={nodeRegistry.current}
                    />
                </div>
            )}
        </div>
    );
});

export default FileTransferComponent;
