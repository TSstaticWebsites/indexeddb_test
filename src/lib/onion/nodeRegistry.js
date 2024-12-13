/**
 * Node discovery and management for browser-based onion routing
 * Handles peer discovery and validation through WebSocket signaling
 */

import { SimpleEventEmitter } from './eventEmitter';
import { LayeredEncryption } from './crypto';

// Node roles in the network
export const NodeRole = {
  ENTRY: 'ENTRY',
  RELAY: 'RELAY',
  EXIT: 'EXIT'
};

// Node status in the network
export const NodeStatus = {
  AVAILABLE: 'AVAILABLE',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE',
  WAITING: 'WAITING'  // New status for nodes waiting for connections
};

// Constants for connection management
export const CONNECTION_CONSTANTS = {
  WAITING_PERIOD: 30000,  // 30 seconds waiting period
  MAX_RECONNECT_ATTEMPTS: 5,
  RECONNECT_BACKOFF_MS: 1000,
  MIN_NODES_REQUIRED: 2
};

export class NodeRegistry {
  constructor() {
    this.nodes = new Map();
    this.localNodeId = crypto.randomUUID();
    this.eventEmitter = new SimpleEventEmitter();
    this.crypto = new LayeredEncryption();
    this.startTime = Date.now();
    this.successfulTransfers = 0;
    this.totalTransfers = 0;
    this.bandwidthSamples = [];
    this.lastBandwidthMeasurement = null;
    this.lastRoleRotation = Date.now();
    this.wsConnected = false;  // Add connection state tracking

    // Get role from URL parameters and validate against NodeRole enum
    const params = new URLSearchParams(window.location.search);
    const urlRole = params.get('role');
    this.localNodeRole = Object.values(NodeRole).includes(urlRole) ? urlRole : NodeRole.RELAY;
    console.log('[Node Registry] Initialized with role:', this.localNodeRole, 'from URL param:', urlRole);

    // Initialize WebSocket connection
    console.log(`[Node Registry] Initializing node ${this.localNodeId.slice(0, 8)}`);

    try {
      // Get base URL without trailing slash and ensure single /ws path
      const baseUrl = process.env.REACT_APP_SIGNALING_SERVER.replace(/\/ws\/?$/, '');
      const wsUrl = `${baseUrl}/ws/${this.localNodeId}`;
      console.log('Connecting to WebSocket URL:', wsUrl);
      this.signaling = new WebSocket(wsUrl);

      // Generate RSA key pair for encryption
      this.keyPairPromise = crypto.subtle.generateKey(
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256'
        },
        true,
        ['encrypt', 'decrypt']
      );

      // Set up handlers after key pair is generated
      this.keyPairPromise.then(keyPair => {
        this.keyPair = keyPair;
        this.setupSignalingHandlers();
        // Register node after WebSocket connection is established
        if (this.signaling.readyState === WebSocket.OPEN) {
          this.registerAsNode(this.localNodeRole);
        }
      }).catch(error => {
        console.error('[Node Registry] Failed to generate key pair:', error);
      });
    } catch (error) {
      console.error('[Node Registry] Failed to initialize node:', error);
      throw error;
    }

    // Add event listeners for node updates with detailed logging
    this.eventEmitter.on('nodeRegistered', (nodeId) => {
      console.log(`[Node ${this.localNodeId.slice(0, 8)}] Node registered event emitted:`, nodeId);
      this.updateNetworkMetrics();
    });

    this.eventEmitter.on('nodeDisconnected', (nodeId) => {
      console.log(`[Node ${this.localNodeId.slice(0, 8)}] Node disconnected event emitted:`, nodeId);
      this.updateNetworkMetrics();
    });
  }

  /**
   * Attempts to reconnect to the signaling server with exponential backoff
   * @returns {Promise<boolean>} Success status of reconnection
   */
  async attemptReconnection() {
    let attempts = 0;
    while (attempts < CONNECTION_CONSTANTS.MAX_RECONNECT_ATTEMPTS) {
      try {
        const backoff = CONNECTION_CONSTANTS.RECONNECT_BACKOFF_MS * Math.pow(2, attempts);
        console.log(`[Reconnection] Attempt ${attempts + 1}, waiting ${backoff}ms`);
        await new Promise(resolve => setTimeout(resolve, backoff));

        const baseUrl = process.env.REACT_APP_SIGNALING_SERVER.replace(/\/ws\/?$/, '');
        const wsUrl = `${baseUrl}/ws/${this.localNodeId}`;
        this.signaling = new WebSocket(wsUrl);
        this.setupSignalingHandlers();

        // Wait for connection to establish
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Connection timeout'));
          }, 5000);

          this.signaling.onopen = () => {
            clearTimeout(timeout);
            resolve();
          };
        });

        console.log(`[Reconnection] Successfully reconnected after ${attempts + 1} attempts`);
        return true;
      } catch (error) {
        console.warn(`[Reconnection] Attempt ${attempts + 1} failed:`, error);
        attempts++;
      }
    }
    console.error('[Reconnection] Max attempts reached, giving up');
    return false;
  }

  updateNetworkMetrics() {
    const nodes = Array.from(this.nodes.values());
    const metrics = {
      totalNodes: nodes.length,
      activeNodes: nodes.filter(node => node.status === NodeStatus.WAITING || node.status === NodeStatus.AVAILABLE).length,
      waitingNodes: nodes.filter(node => node.status === NodeStatus.WAITING).length,
      readyNodes: nodes.filter(node => node.status === NodeStatus.AVAILABLE).length,
      avgLatency: this.getAvailableBandwidth(),
      avgBandwidth: this.getReliabilityScore()
    };
    this.eventEmitter.emit('metricsUpdated', metrics);
  }

  /**
   * Set up WebSocket event handlers for signaling
   */
  setupSignalingHandlers() {
    console.log(`[Signaling] Setting up handlers for node ${this.localNodeId.slice(0, 8)}`);

    this.signaling.onopen = () => {
      console.log(`[Signaling] WebSocket connected for node ${this.localNodeId.slice(0, 8)}`);
      this.wsConnected = true;  // Update connection state
      // Node registration is now handled by the constructor
    };

    this.signaling.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`[Signaling] Received message type: ${data.type} from ${data.nodeId?.slice(0, 8) || 'unknown'}`);

        switch (data.type) {
          case 'NODE_ANNOUNCEMENT':
            await this.handleNodeAnnouncement(data);
            break;
          case 'NODE_STATUS':
            await this.handleNodeStatus(data);
            break;
          case 'NODE_VALIDATION':
            await this.handleNodeValidation(data);
            break;
          default:
            console.log(`[Signaling] Unhandled message type: ${data.type}`);
        }
      } catch (error) {
        console.error(`[Signaling] Error handling message:`, error);
      }
    };

    this.signaling.onclose = () => {
      console.log(`[Signaling] WebSocket closed for node ${this.localNodeId.slice(0, 8)}`);
      this.wsConnected = false;  // Update connection state
      this.attemptReconnection();
    };

    this.signaling.onerror = (error) => {
      console.error(`[Signaling] WebSocket error for node ${this.localNodeId.slice(0, 8)}:`, error);
    };
  }

  /**
   * Register this instance as a node in the network
   * @param {NodeRole} providedRole - Role override for the node
   */
  async registerAsNode(providedRole) {
    console.log(`[Node Registration] Starting registration process with WebSocket state:`, this.signaling?.readyState);
    try {
      // Wait for key pair to be generated
      if (!this.keyPair) {
        console.log('[Node Registration] Waiting for key pair generation...');
        this.keyPair = await this.keyPairPromise;
      }

      const location = await this.getApproximateLocation();
      console.log(`[Node Registration] Got location:`, location);

      // Use provided role or get from URL, fallback to RELAY
      const role = providedRole || this.selectInitialRole();
      console.log(`[Node Registration] Using role:`, role);

      // Set initial status to WAITING
      this.status = NodeStatus.WAITING;

      // Wait for WebSocket connection to be ready
      if (!this.signaling || this.signaling.readyState !== WebSocket.OPEN) {
        console.log('[Node Registration] WebSocket not ready, attempting to connect...');
        const baseUrl = process.env.REACT_APP_SIGNALING_SERVER || 'wss://app-bxlpryvg.fly.dev';
        const wsUrl = `${baseUrl}/ws/${this.localNodeId}`;
        console.log(`[Node Registration] Connecting to WebSocket at ${wsUrl}`);

        this.signaling = new WebSocket(wsUrl);
        this.setupSignalingHandlers();

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WebSocket connection timeout'));
          }, 5000);

          const onOpen = () => {
            clearTimeout(timeout);
            resolve();
          };

          this.signaling.addEventListener('open', onOpen);
          this.signaling.addEventListener('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });
      }

      console.log(`[Node Registration] WebSocket connected, preparing announcement`);
      const announcement = {
        type: 'NODE_ANNOUNCEMENT',
        nodeId: this.localNodeId,
        role: role,
        status: NodeStatus.WAITING,
        location: location,
        publicKey: await crypto.subtle.exportKey(
          'spki',
          this.keyPair.publicKey
        )
      };

      console.log(`[Node Registration] Sending announcement:`, {
        nodeId: announcement.nodeId.slice(0, 8),
        role: announcement.role,
        status: announcement.status
      });

      this.signaling.send(JSON.stringify(announcement));
      console.log(`[Node Registration] Announcement sent successfully`);

      // Start waiting period with active node discovery
      console.log('[Node Registration] Starting waiting period with active discovery');
      const discoveryInterval = setInterval(async () => {
        try {
          const nodes = await this.discoverNodes();
          console.log(`[Node Discovery] Found ${nodes.length} nodes:`,
            nodes.map(n => ({ id: n.nodeId.slice(0, 8), role: n.role, status: n.status }))
          );
          this.updateNetworkMetrics();
        } catch (error) {
          console.error('[Node Discovery] Error during discovery:', error);
        }
      }, 5000);  // Check every 5 seconds

      setTimeout(() => {
        clearInterval(discoveryInterval);  // Stop discovery interval
        const connectedNodes = Array.from(this.nodes.values()).filter(
          node => node.status === NodeStatus.WAITING || node.status === NodeStatus.AVAILABLE
        ).length;

        console.log(`[Node Registration] Waiting period ended. Connected nodes: ${connectedNodes}`);
        if (connectedNodes >= CONNECTION_CONSTANTS.MIN_NODES_REQUIRED) {
          console.log('[Node Registration] Sufficient nodes joined during waiting period');
          this.updateStatus(NodeStatus.AVAILABLE);
          // Notify other nodes
          const statusUpdate = {
            type: 'NODE_STATUS',
            nodeId: this.localNodeId,
            status: NodeStatus.AVAILABLE
          };
          this.signaling.send(JSON.stringify(statusUpdate));
        } else {
          console.log('[Node Registration] Not enough nodes joined during waiting period');
          // Keep waiting for more nodes
          this.updateNetworkMetrics();
        }
      }, CONNECTION_CONSTANTS.WAITING_PERIOD);

    } catch (error) {
      console.error(`[Node Registration] Registration failed:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming node announcements
   * @private
   * @param {Object} data - Node announcement data
   */
  async handleNodeAnnouncement(data) {
    if (data.nodeId === this.localNodeId) return;

    console.log(`[Node ${this.localNodeId.slice(0, 8)}] Processing node announcement:`, {
      nodeId: data.nodeId.slice(0, 8),
      role: data.role,
      location: data.location
    });

    this.nodes.set(data.nodeId, {
      role: data.role,
      status: data.status,
      location: data.location,
      publicKey: await crypto.subtle.importKey(
        'spki',
        this.crypto.base64ToArrayBuffer(data.publicKey),
        {
          name: 'RSA-OAEP',
          hash: 'SHA-256'
        },
        true,
        ['encrypt']
      ),
      lastSeen: Date.now()
    });

    // Emit nodeRegistered event after successfully adding the node
    this.eventEmitter.emit('nodeRegistered', data.nodeId);

    // Update network metrics after node addition
    this.updateNetworkMetrics();
  }

  /**
   * Handle node status updates
   * @private
   * @param {Object} data - Node status data
   */
  handleNodeStatus(data) {
    const node = this.nodes.get(data.nodeId);
    if (node) {
      node.status = data.status;
      node.lastSeen = Date.now();
      this.updateNetworkMetrics();
    }
  }

  /**
   * Handle node validation requests
   * @private
   * @param {Object} data - Validation request data
   */
  async handleNodeValidation(data) {
    if (data.targetNodeId === this.localNodeId) {
      const response = {
        type: 'node_validation_response',
        nodeId: this.localNodeId,
        targetNodeId: data.nodeId,
        timestamp: Date.now(),
        status: this.status,
        capabilities: {
          maxBandwidth: this.getAvailableBandwidth(),
          latency: await this.measureLatency(data.nodeId)
        }
      };
      this.signaling.send(JSON.stringify(response));
    }
  }

  /**
   * Discover available relay nodes with enhanced anonymity properties
   * @param {NodeRole} role - Optional role to filter nodes by
   * @returns {Promise<Array<{nodeId: string, role: NodeRole, status: NodeStatus}>>}
   */
  async discoverNodes(role = null) {
    // Wait for WebSocket connection to be ready
    if (!this.signaling || this.signaling.readyState !== WebSocket.OPEN) {
      console.log('[Node Registry] Waiting for WebSocket connection to be ready...');
      try {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('WebSocket connection timeout'));
          }, 5000);

          const checkConnection = () => {
            if (this.signaling.readyState === WebSocket.OPEN) {
              clearTimeout(timeout);
              resolve();
            } else if (this.signaling.readyState === WebSocket.CLOSED || this.signaling.readyState === WebSocket.CLOSING) {
              clearTimeout(timeout);
              reject(new Error('WebSocket connection failed'));
            } else {
              setTimeout(checkConnection, 100);
            }
          };
          checkConnection();
        });
      } catch (error) {
        console.error('[Node Registry] Failed to establish WebSocket connection:', error);
        return [];
      }
    }

    const discovery = {
      type: 'node_discovery',
      requestId: crypto.randomUUID(),
      capabilities: {
        bandwidth: this.getAvailableBandwidth(),
        latency: await this.measureLatency(),
        geolocation: await this.getApproximateLocation(),
        uptime: Date.now() - this.startTime,
        reliability: this.getReliabilityScore()
      }
    };
    this.signaling.send(JSON.stringify(discovery));

    // Wait for responses and filter nodes
    await new Promise(resolve => setTimeout(resolve, 2000));
    const now = Date.now();

    // Get active nodes and filter based on enhanced criteria
    const activeNodes = Array.from(this.nodes.entries())
      .filter(([nodeId, node]) => {
        // During waiting period, include all recently seen nodes
        if (this.status === NodeStatus.WAITING) {
          return (now - node.lastSeen <= 30000) && nodeId !== this.localNodeId;
        }

        // Basic availability checks
        if (now - node.lastSeen > 30000) return false;
        if (role && node.role !== role) return false;

        // Enhanced anonymity checks only after waiting period
        if (!this.hasGeographicDiversity(node)) return false;
        if (!this.meetsReliabilityThreshold(node)) return false;
        if (!this.hasAcceptableLatency(node)) return false;

        return true;
      })
      .map(([nodeId, node]) => ({
        nodeId,
        role: node.role,
        status: node.status,
        capabilities: node.capabilities
      }));

    return activeNodes;
  }

  /**
   * Validate a specific node's capabilities and reliability
   * @param {string} nodeId - ID of the node to validate
   * @returns {Promise<boolean>} Whether the node is valid and reliable
   */
  async validateNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return false;

    const validation = {
      type: 'node_validation',
      nodeId: this.localNodeId,
      targetNodeId: nodeId,
      timestamp: Date.now()
    };
    this.signaling.send(JSON.stringify(validation));

    // Wait for validation response
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      const handler = (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'node_validation_response' &&
            data.nodeId === nodeId &&
            data.targetNodeId === this.localNodeId) {
          clearTimeout(timeout);
          this.signaling.removeEventListener('message', handler);
          resolve(this.evaluateNodeCapabilities(data.capabilities));
        }
      };
      this.signaling.addEventListener('message', handler);
    });
  }

  /**
   * Evaluate node capabilities for reliability and anonymity requirements
   * @private
   * @param {Object} capabilities - Node capabilities data
   * @returns {boolean} Whether the node meets minimum requirements
   */
  evaluateNodeCapabilities(capabilities) {
    const MIN_BANDWIDTH = 50 * 1024; // 50 KB/s
    const MAX_LATENCY = 1000; // 1 second
    const MIN_UPTIME = 5 * 60 * 1000; // 5 minutes
    const MIN_RELIABILITY = 0.8; // 80% success rate

    // Basic capability checks
    if (!capabilities.maxBandwidth || !capabilities.latency ||
        !capabilities.uptime || !capabilities.reliability) {
      return false;
    }

    // Verify all requirements are met
    return capabilities.maxBandwidth >= MIN_BANDWIDTH &&
           capabilities.latency <= MAX_LATENCY &&
           capabilities.uptime >= MIN_UPTIME &&
           capabilities.reliability >= MIN_RELIABILITY &&
           this.hasGeographicDiversity({ capabilities }) &&
           this.meetsReliabilityThreshold({ capabilities });
  }

  /**
   * Measure latency to a node
   * @private
   * @param {string} nodeId - ID of the node to measure
   * @returns {Promise<number>} Latency in milliseconds
   */
  async measureLatency(nodeId) {
    const start = Date.now();
    const ping = {
      type: 'node_ping',
      nodeId: this.localNodeId,
      targetNodeId: nodeId,
      timestamp: start
    };
    this.signaling.send(JSON.stringify(ping));

    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(Infinity), 5000);
      const handler = (message) => {
        const data = JSON.parse(message.data);
        if (data.type === 'node_pong' &&
            data.nodeId === nodeId &&
            data.targetNodeId === this.localNodeId) {
          clearTimeout(timeout);
          this.signaling.removeEventListener('message', handler);
          resolve(Date.now() - start);
        }
      };
      this.signaling.addEventListener('message', handler);
    });
  }

  /**
   * Get available bandwidth for this node
   * @private
   * @returns {number} Available bandwidth in bytes per second
   */
  getAvailableBandwidth() {
    // Use navigator.connection if available
    if (navigator.connection) {
      const connection = navigator.connection;
      if (connection.downlink) {
        return connection.downlink * 1024 * 1024 / 8; // Convert Mbps to Bytes/s
      }
    }
    return 1024 * 1024; // Fallback: 1 MB/s
  }



  /**
   * Get approximate location using RTT measurements
   * @private
   * @returns {Promise<Object>} Approximate geolocation data
   */
  async getApproximateLocation() {
    try {
      // Try to get precise location first
      const position = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error('Geolocation not supported'));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
          maximumAge: 300000
        });
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: position.timestamp
      };
    } catch (error) {
      console.warn('Geolocation failed, using IP-based fallback:', error);

      // Fallback to approximate location using predefined regions
      const fallbackRegions = [
        { region: 'NA', latitude: 37.0902, longitude: -95.7129 }, // USA
        { region: 'EU', latitude: 51.1657, longitude: 10.4515 }, // Germany
        { region: 'AS', latitude: 35.6762, longitude: 139.6503 }, // Japan
      ];

      // Select a random region for diversity
      const fallback = fallbackRegions[Math.floor(Math.random() * fallbackRegions.length)];

      // Add some randomization within the region
      return {
        latitude: fallback.latitude + (Math.random() - 0.5) * 2,
        longitude: fallback.longitude + (Math.random() - 0.5) * 2,
        accuracy: 1000,
        timestamp: Date.now(),
        isFallback: true
      };
    }
  }

  /**
   * Check if node adds geographic diversity to the network
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether node adds geographic diversity
   */
  hasGeographicDiversity(node) {
    if (!node.capabilities?.geolocation) return false;

    // Compare RTT profiles to ensure nodes are geographically distributed
    const existingProfiles = Array.from(this.nodes.values())
      .filter(n => n.capabilities?.geolocation)
      .map(n => n.capabilities.geolocation.rttProfile);

    return !existingProfiles.some(profile =>
      this.isRTTProfileSimilar(profile, node.capabilities.geolocation.rttProfile)
    );
  }

  /**
   * Compare RTT profiles for similarity
   * @private
   * @param {Array} profile1 - First RTT profile
   * @param {Array} profile2 - Second RTT profile
   * @returns {boolean} Whether profiles are similar
   */
  isRTTProfileSimilar(profile1, profile2) {
    const SIMILARITY_THRESHOLD = 50; // ms
    return profile1.every((rtt, i) =>
      Math.abs(rtt - profile2[i]) < SIMILARITY_THRESHOLD
    );
  }

  /**
   * Check if node meets reliability threshold
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether node is reliable
   */
  meetsReliabilityThreshold(node) {
    const MIN_RELIABILITY = 0.8;
    return node.capabilities?.reliability >= MIN_RELIABILITY;
  }

  /**
   * Check if node has acceptable latency
   * @private
   * @param {Object} node - Node to check
   * @returns {boolean} Whether node has acceptable latency
   */
  hasAcceptableLatency(node) {
    const MAX_LATENCY = 1000; // 1 second
    return node.capabilities?.latency <= MAX_LATENCY;
  }

  /**
   * Track successful transfer completion
   * @private
   */
  recordTransferSuccess() {
    this.successfulTransfers++;
    this.totalTransfers++;
  }

  /**
   * Track failed transfer
   * @private
   */
  recordTransferFailure() {
    this.totalTransfers++;
  }

  /**
   * Get reliability score based on successful operations
   * @private
   * @returns {number} Score between 0 and 1
   */
  getReliabilityScore() {
    if (this.totalTransfers === 0) return 1.0; // New nodes start with perfect score
    return this.successfulTransfers / this.totalTransfers;
  }

  /**
   * Get node uptime in milliseconds
   * @private
   * @returns {number} Uptime in milliseconds
   */
  getUptime() {
    return Date.now() - this.startTime;
  }

  /**
   * Measure available bandwidth using WebRTC data channels
   * @private
   * @returns {Promise<number>} Available bandwidth in bytes per second
   */
  async measureBandwidth() {
    const now = Date.now();

    // Only measure bandwidth every 30 seconds
    if (this.lastBandwidthMeasurement &&
        now - this.lastBandwidthMeasurement < 30000) {
      return this.bandwidthSamples[this.bandwidthSamples.length - 1] || 1024 * 1024;
    }

    try {
      // Create temporary data channel for measurement
      const pc1 = new RTCPeerConnection();
      const pc2 = new RTCPeerConnection();
      const dc1 = pc1.createDataChannel('bandwidth-test');

      // Set up connection
      pc2.ondatachannel = (event) => {
        const dc2 = event.channel;
        dc2.onmessage = (e) => {
          const endTime = performance.now();
          const duration = endTime - startTime;
          const bytesPerSecond = (TEST_SIZE / duration) * 1000;

          this.bandwidthSamples.push(bytesPerSecond);
          if (this.bandwidthSamples.length > 5) {
            this.bandwidthSamples.shift();
          }

          this.lastBandwidthMeasurement = now;
          pc1.close();
          pc2.close();
        };
      };

      // Connect peers
      const offer = await pc1.createOffer();
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);
      const answer = await pc2.createAnswer();
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);

      // Wait for connection
      await new Promise(resolve => {
        const checkState = () => {
          if (dc1.readyState === 'open') {
            resolve();
          } else {
            setTimeout(checkState, 100);
          }
        };
        checkState();
      });

      // Send test data
      const TEST_SIZE = 1024 * 256; // 256KB
      const testData = new Uint8Array(TEST_SIZE);
      const startTime = performance.now();
      dc1.send(testData);

      // Return average of recent samples
      return this.bandwidthSamples.reduce((a, b) => a + b, 0) /
             Math.max(1, this.bandwidthSamples.length);
    } catch (error) {
      console.warn('Bandwidth measurement failed:', error);
      return 1024 * 1024; // Fallback: 1 MB/s
    }
  }

  /**
   * Update local node status and handle role rotation
   * @param {NodeStatus} status - New status
   */
  updateStatus(status) {
    this.status = status;

    // Rotate roles every 30 minutes
    const ROLE_ROTATION_INTERVAL = 30 * 60 * 1000;
    if (Date.now() - this.lastRoleRotation > ROLE_ROTATION_INTERVAL) {
      this.role = this.selectNewRole();
      this.lastRoleRotation = Date.now();
    }

    const statusUpdate = {
      type: 'node_status',
      nodeId: this.localNodeId,
      status: this.status,
      role: this.role
    };
    this.signaling.send(JSON.stringify(statusUpdate));
  }

  /**
   * Get suitable relays for circuit building with enhanced selection criteria
   * @param {number} count - Number of relays needed
   * @returns {Promise<Array<{nodeId: string, role: NodeRole}>>}
   */
  async getSuitableRelays(count) {
    // Get all available relays
    const allNodes = await this.discoverNodes();

    // Filter and sort nodes by capability score
    const validated = allNodes
      .filter(node => {
        const capabilities = this.nodes.get(node.nodeId)?.capabilities;
        return capabilities && this.evaluateNodeCapabilities(capabilities);
      })
      .sort((a, b) => {
        const capA = this.nodes.get(a.nodeId).capabilities;
        const capB = this.nodes.get(b.nodeId).capabilities;
        return this.calculateNodeScore(capB) - this.calculateNodeScore(capA);
      });

    // Ensure geographic diversity in selection
    const diverseNodes = this.ensureGeographicDiversity(validated);

    // Select nodes based on role requirements
    const selected = [];
    const roles = [NodeRole.ENTRY, ...Array(count - 2).fill(NodeRole.RELAY), NodeRole.EXIT];

    for (const requiredRole of roles) {
      const suitable = diverseNodes.filter(node =>
        node.role === requiredRole &&
        !selected.includes(node)
      );

      if (suitable.length === 0) return []; // Can't build circuit

      // Select randomly from top 3 candidates to prevent predictability
      const topCandidates = suitable.slice(0, Math.min(3, suitable.length));
      const selected_node = topCandidates[Math.floor(Math.random() * topCandidates.length)];
      selected.push(selected_node);
    }

    return selected;
  }

  calculateNodeScore(capabilities) {
    const weights = {
      bandwidth: 0.3,
      latency: 0.2,
      reliability: 0.3,
      uptime: 0.2
    };

    const scores = {
      bandwidth: Math.min(capabilities.maxBandwidth / (1024 * 1024), 1),
      latency: Math.max(0, 1 - capabilities.latency / 1000),
      reliability: capabilities.reliability,
      uptime: Math.min(capabilities.uptime / (24 * 60 * 60 * 1000), 1)
    };

    return Object.entries(weights).reduce((total, [metric, weight]) =>
      total + (scores[metric] * weight), 0);
  }

  ensureGeographicDiversity(nodes) {
    const regions = new Map();
    return nodes.filter(node => {
      const region = this.determineRegion(node);
      if (!regions.has(region)) {
        regions.set(region, 1);
        return true;
      }
      const count = regions.get(region);
      if (count < 2) { // Allow max 2 nodes per region
        regions.set(region, count + 1);
        return true;
      }
      return false;
    });
  }

  determineRegion(node) {
    // Use precise location data if available
    if (node?.location?.latitude && node?.location?.longitude) {
      const regions = {
        'NA': { minLat: 15, maxLat: 72, minLng: -168, maxLng: -52 },  // North America
        'EU': { minLat: 36, maxLat: 71, minLng: -11, maxLng: 40 },    // Europe
        'AS': { minLat: -10, maxLat: 77, minLng: 40, maxLng: 180 },   // Asia
        'SA': { minLat: -56, maxLat: 15, minLng: -81, maxLng: -34 },  // South America
        'AF': { minLat: -35, maxLat: 37, minLng: -18, maxLng: 52 },   // Africa
        'OC': { minLat: -47, maxLat: -10, minLng: 110, maxLng: 180 }  // Oceania
      };

      for (const [region, bounds] of Object.entries(regions)) {
        if (node.location.latitude >= bounds.minLat &&
            node.location.latitude <= bounds.maxLat &&
            node.location.longitude >= bounds.minLng &&
            node.location.longitude <= bounds.maxLng) {
          return region;
        }
      }
    }

    // Fallback to RTT profile if precise location not available
    if (node?.capabilities?.geolocation?.rttProfile) {
      const rtts = node.capabilities.geolocation.rttProfile;
      const minRTT = Math.min(...rtts);
      const minIndex = rtts.indexOf(minRTT);
      return ['NA', 'EU', 'AS'][minIndex] || 'UN';
    }

    return 'UN'; // Unknown region
  }

  /**
   * Select initial role for this node
   * @private
   * @returns {NodeRole} Selected role
   */
  selectInitialRole() {
    // Return the role that was set during initialization
    console.log('[Node Registry] Using initialized role:', this.localNodeRole);
    return this.localNodeRole;
  }

  /**
   * Select new role during rotation
   * @private
   * @returns {NodeRole} New role
   */
  selectNewRole() {
    const roles = [NodeRole.RELAY, NodeRole.ENTRY, NodeRole.EXIT];
    const currentIndex = roles.indexOf(this.role);
    return roles[(currentIndex + 1) % roles.length];
  }
}
