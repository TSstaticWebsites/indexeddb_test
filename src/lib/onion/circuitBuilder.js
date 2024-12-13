/**
 * Circuit building logic for browser-based onion routing
 * Implements anonymous circuit creation with perfect forward secrecy
 */

import { NodeRole } from './types';
import { NodeStatus } from './types';

// Circuit status
export const CircuitStatus = {
  BUILDING: 'building',
  READY: 'ready',
  FAILED: 'failed',
  CLOSED: 'closed'
};

export class CircuitBuilder {
  constructor(nodeRegistry, layeredEncryption) {
    this.nodeRegistry = nodeRegistry;
    this.encryption = layeredEncryption;
    this.circuits = new Map();
    this.MIN_HOPS = 2;  // Changed from 3 to 2 to support 2-node circuits
  }

  /**
   * Build a new circuit through the onion network
   * @param {number} numHops - Number of hops in the circuit (minimum 2)
   * @returns {Promise<{circuitId: string, status: CircuitStatus}>}
   */
  async buildCircuit(numHops = 2) {  // Changed default from 3 to 2
    if (numHops < this.MIN_HOPS) {
      numHops = this.MIN_HOPS;
    }

    const circuitId = crypto.randomUUID();
    this.circuits.set(circuitId, {
      status: CircuitStatus.BUILDING,
      hops: [],
      connections: [],
      keys: []
    });

    try {
      // Get suitable relay nodes based on performance metrics
      const relays = await this.nodeRegistry.getSuitableRelays(numHops);
      console.log(`[Circuit Builder] Found ${relays.length} suitable relays for ${numHops} hops`);
      console.log('[Circuit Builder] Available relays:', relays.map(r => ({
        id: r.nodeId.slice(0, 8),
        status: r.status,
        role: r.role
      })));

      // For two-node circuits, we only need one other node
      const requiredNodes = numHops === 2 ? 1 : numHops;

      if (relays.length < requiredNodes) {
        console.log('[Circuit Builder] Waiting for more nodes to become available...');
        console.log(`[Circuit Builder] Current nodes: ${relays.length}, Required: ${requiredNodes}`);
        // Emit event for UI update
        this.nodeRegistry.eventEmitter.emit('circuitBuildingStatus', {
          status: CircuitStatus.BUILDING,
          message: 'Waiting for more nodes...'
        });
        return { circuitId, status: CircuitStatus.BUILDING };
      }

      // Generate circuit keys
      const circuitKeys = await this.encryption.createCircuitKeys(numHops);
      this.circuits.get(circuitId).keys = circuitKeys;

      // Build circuit hop by hop
      let previousHop = null;
      for (let i = 0; i < numHops; i++) {
        const node = relays[i % relays.length]; // Use modulo for two-node circuits
        console.log(`[Circuit Builder] Establishing hop ${i + 1}/${numHops} with node ${node.nodeId.slice(0, 8)} (${node.role})`);

        try {
          const hop = await this.establishHop(circuitId, node, previousHop, i);
          this.circuits.get(circuitId).hops.push(hop);
          previousHop = hop;
          console.log(`[Circuit Builder] Hop ${i + 1} established successfully`);
        } catch (error) {
          console.error(`[Circuit Builder] Failed to establish hop ${i + 1}:`, error);
          this.circuits.get(circuitId).status = CircuitStatus.FAILED;
          throw error;
        }
      }

      console.log('[Circuit Builder] Circuit established successfully');
      this.circuits.get(circuitId).status = CircuitStatus.READY;
      return { circuitId, status: CircuitStatus.READY };
    } catch (error) {
      console.error('[Circuit Builder] Failed to build circuit:', error);
      this.circuits.get(circuitId).status = CircuitStatus.FAILED;
      throw error;
    }
  }

  /**
   * Establish a single hop in the circuit
   * @private
   * @param {string} circuitId - ID of the circuit being built
   * @param {Object} node - Node information for this hop
   * @param {Object} previousHop - Previous hop in the circuit
   * @param {number} hopIndex - Index of this hop in the circuit
   * @returns {Promise<Object>} Hop information
   */
  async establishHop(circuitId, node, previousHop, hopIndex) {
    const circuit = this.circuits.get(circuitId);
    console.log(`[Circuit Builder] Setting up hop ${hopIndex} with node ${node.nodeId.slice(0, 8)}`);

    // Create WebRTC connection for this hop
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Create data channel with more reliable settings for two-node circuits
    const dataChannel = peerConnection.createDataChannel(`circuit-${circuitId}-${hopIndex}`, {
      ordered: true,
      maxRetransmits: 3
    });

    // Set up connection handlers with improved logging
    const connectionPromise = new Promise((resolve, reject) => {
      let timeoutId = setTimeout(() => {
        console.error(`[Circuit Builder] Connection timeout for hop ${hopIndex}`);
        reject(new Error('Connection timeout'));
      }, 30000);

      dataChannel.onopen = () => {
        clearTimeout(timeoutId);
        console.log(`[Circuit Builder] Data channel opened for hop ${hopIndex}`);
        resolve();
      };

      dataChannel.onerror = (error) => {
        clearTimeout(timeoutId);
        console.error(`[Circuit Builder] Data channel error for hop ${hopIndex}:`, error);
        reject(error);
      };

      // Add connection state change handler
      peerConnection.onconnectionstatechange = () => {
        console.log(`[Circuit Builder] Connection state for hop ${hopIndex}:`, peerConnection.connectionState);
      };
    });

    // Create and send circuit establishment message
    const establishmentData = {
      type: 'circuit_establish',
      circuitId,
      hopIndex,
      previousHopId: previousHop?.nodeId,
      nextHopPublicKey: circuit.keys[hopIndex].publicKey
    };

    // Encrypt establishment data for this hop
    const { encryptedData, encryptedKey, iv } = await this.encryption.encryptLayer(
      new TextEncoder().encode(JSON.stringify(establishmentData)),
      node.publicKey
    );

    // Send establishment message through signaling
    const signaling = {
      type: 'circuit_signaling',
      targetNodeId: node.nodeId,
      encryptedData: this.encryption.arrayBufferToBase64(encryptedData),
      encryptedKey: this.encryption.arrayBufferToBase64(encryptedKey),
      iv: Array.from(iv)
    };

    // Store connection information
    circuit.connections.push({
      nodeId: node.nodeId,
      peerConnection,
      dataChannel
    });

    try {
      // Wait for connection establishment
      await connectionPromise;
      console.log(`[Circuit Builder] Hop ${hopIndex} established successfully`);
      return {
        nodeId: node.nodeId,
        hopIndex,
        publicKey: node.publicKey
      };
    } catch (error) {
      console.error(`[Circuit Builder] Failed to establish hop ${hopIndex}:`, error);
      throw error;
    }
  }

  /**
   * Send data through an established circuit
   * @param {string} circuitId - ID of the circuit to use
   * @param {ArrayBuffer} data - Data to send
   * @returns {Promise<void>}
   */
  async sendThroughCircuit(circuitId, data) {
    const circuit = this.circuits.get(circuitId);
    if (!circuit || circuit.status !== CircuitStatus.READY) {
      throw new Error('Circuit not ready');
    }

    // Create onion-encrypted message
    const publicKeys = circuit.hops.map(hop => hop.publicKey);
    const { data: encryptedData, keys: encryptedKeys, ivs } =
      await this.encryption.createOnion(data, publicKeys);

    // Prepare circuit message
    const message = {
      type: 'circuit_data',
      circuitId,
      data: this.encryption.arrayBufferToBase64(encryptedData),
      keys: encryptedKeys.map(key => this.encryption.arrayBufferToBase64(key)),
      ivs: ivs.map(iv => Array.from(iv))
    };

    // Send through first hop
    circuit.connections[0].dataChannel.send(JSON.stringify(message));
  }

  /**
   * Close a circuit and clean up resources
   * @param {string} circuitId - ID of the circuit to close
   */
  async closeCircuit(circuitId) {
    const circuit = this.circuits.get(circuitId);
    if (!circuit) return;

    // Close all connections
    circuit.connections.forEach(({ peerConnection, dataChannel }) => {
      dataChannel.close();
      peerConnection.close();
    });

    circuit.status = CircuitStatus.CLOSED;
    this.circuits.delete(circuitId);
  }

  /**
   * Get the status of a circuit
   * @param {string} circuitId - ID of the circuit
   * @returns {CircuitStatus} Current status of the circuit
   */
  getCircuitStatus(circuitId) {
    const circuit = this.circuits.get(circuitId);
    return circuit ? circuit.status : CircuitStatus.CLOSED;
  }
}
