/**
 * Circuit building logic for browser-based onion routing
 * Implements anonymous circuit creation with perfect forward secrecy
 */

import { NodeRole } from './nodeRegistry';

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
    this.MIN_HOPS = 3;
  }

  /**
   * Build a new circuit through the onion network
   * @param {number} numHops - Number of hops in the circuit (minimum 3)
   * @returns {Promise<{circuitId: string, status: CircuitStatus}>}
   */
  async buildCircuit(numHops = 3) {
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
      // Get suitable relay nodes
      const relays = await this.nodeRegistry.getSuitableRelays(numHops);
      if (relays.length < numHops) {
        throw new Error('Insufficient relay nodes available');
      }

      // Generate circuit keys
      const circuitKeys = await this.encryption.createCircuitKeys(numHops);
      this.circuits.get(circuitId).keys = circuitKeys;

      // Build circuit hop by hop
      let previousHop = null;
      for (let i = 0; i < numHops; i++) {
        const node = relays[i];
        const hop = await this.establishHop(circuitId, node, previousHop, i);
        this.circuits.get(circuitId).hops.push(hop);
        previousHop = hop;
      }

      this.circuits.get(circuitId).status = CircuitStatus.READY;
      return { circuitId, status: CircuitStatus.READY };
    } catch (error) {
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

    // Create WebRTC connection for this hop
    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Create data channel
    const dataChannel = peerConnection.createDataChannel(`circuit-${circuitId}-${hopIndex}`, {
      ordered: true,
      maxRetransmits: 0
    });

    // Set up connection handlers
    const connectionPromise = new Promise((resolve, reject) => {
      let timeoutId = setTimeout(() => reject(new Error('Connection timeout')), 30000);

      dataChannel.onopen = () => {
        clearTimeout(timeoutId);
        resolve();
      };

      dataChannel.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(error);
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

    // Wait for connection establishment
    await connectionPromise;

    return {
      nodeId: node.nodeId,
      hopIndex,
      publicKey: node.publicKey
    };
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
