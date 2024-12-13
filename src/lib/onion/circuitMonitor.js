import { CircuitStatus } from './circuitBuilder';
import { NodeStatus } from './types';
import { CONNECTION_CONSTANTS } from './constants';

export class CircuitMonitor {
  constructor(circuit, circuitBuilder, nodeRegistry) {
    this.circuit = circuit;
    this.circuitBuilder = circuitBuilder;
    this.nodeRegistry = nodeRegistry;
    this.healthCheckInterval = null;
    this.listeners = new Set();
  }

  /**
   * Start monitoring circuit health
   * @param {number} interval - Health check interval in milliseconds
   */
  startMonitoring(interval = 5000) {
    this.healthCheckInterval = setInterval(() => this.checkCircuitHealth(), interval);
  }

  /**
   * Stop monitoring circuit health
   */
  stopMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Add circuit status change listener
   * @param {Function} listener - Callback function for status changes
   */
  addStatusListener(listener) {
    this.listeners.add(listener);
  }

  /**
   * Remove circuit status change listener
   * @param {Function} listener - Callback function to remove
   */
  removeStatusListener(listener) {
    this.listeners.delete(listener);
  }

  /**
   * Notify listeners of circuit status change
   * @private
   * @param {CircuitStatus} status - New circuit status
   * @param {Object} details - Additional status details
   */
  notifyListeners(status, details = {}) {
    this.listeners.forEach(listener => listener(status, details));
  }

  /**
   * Check health of all nodes in the circuit
   * @private
   */
  async checkCircuitHealth() {
    const nodes = await this.nodeRegistry.discoverNodes();
    const circuitNodes = this.circuitBuilder.getCircuitNodes(this.circuit);

    // Check if we have enough nodes before proceeding
    const availableNodes = nodes.filter(n => n.status === NodeStatus.AVAILABLE).length;
    const waitingNodes = nodes.filter(n => n.status === NodeStatus.WAITING).length;

    if (availableNodes < CONNECTION_CONSTANTS.MIN_NODES_REQUIRED) {
      this.notifyListeners(CircuitStatus.WAITING, {
        availableNodes,
        waitingNodes,
        requiredNodes: CONNECTION_CONSTANTS.MIN_NODES_REQUIRED
      });
      return;
    }

    const nodeHealthDetails = [];
    let hasUnhealthyNode = false;
    let totalLatency = 0;
    let minBandwidth = Infinity;
    let healthyNodeCount = 0;

    for (const nodeId of circuitNodes) {
      const node = nodes.find(n => n.nodeId === nodeId);
      const nodeHealth = {
        nodeId,
        status: node?.status || 'OFFLINE',
        role: node?.role || 'UNKNOWN',
        location: node?.location || null,
        metrics: {
          latency: null,
          bandwidth: null,
          reliability: null,
          uptime: null
        }
      };

      if (node && node.status === NodeStatus.AVAILABLE) {
        // Validate node capabilities and collect metrics
        const capabilities = await this.nodeRegistry.getNodeCapabilities(nodeId);
        const isValid = await this.nodeRegistry.validateNode(nodeId);

        if (isValid) {
          healthyNodeCount++;
          nodeHealth.metrics = {
            latency: capabilities.latency,
            bandwidth: capabilities.maxBandwidth,
            reliability: capabilities.reliability,
            uptime: capabilities.uptime
          };
          totalLatency += capabilities.latency;
          minBandwidth = Math.min(minBandwidth, capabilities.maxBandwidth);
        } else {
          hasUnhealthyNode = true;
          nodeHealth.status = 'INVALID';
        }
      } else {
        hasUnhealthyNode = true;
      }

      nodeHealthDetails.push(nodeHealth);
    }

    const circuitHealth = {
      totalNodes: circuitNodes.length,
      healthyNodes: healthyNodeCount,
      averageLatency: totalLatency / healthyNodeCount || 0,
      bandwidth: minBandwidth === Infinity ? 0 : minBandwidth,
      nodeDetails: nodeHealthDetails,
      timestamp: Date.now()
    };

    if (hasUnhealthyNode) {
      const unhealthyNodes = nodeHealthDetails
        .filter(n => n.status !== NodeStatus.AVAILABLE)
        .map(n => n.nodeId);

      this.notifyListeners(CircuitStatus.DEGRADED, {
        ...circuitHealth,
        unhealthyNodes
      });

      await this.handleUnhealthyNodes(unhealthyNodes);
    } else {
      this.notifyListeners(CircuitStatus.READY, circuitHealth);
    }
  }

  /**
   * Handle unhealthy nodes in the circuit
   * @private
   * @param {Array<string>} unhealthyNodes - Array of unhealthy node IDs
   */
  async handleUnhealthyNodes(unhealthyNodes) {
    // If more than 1/3 of nodes are unhealthy, rebuild the entire circuit
    const circuitNodes = this.circuitBuilder.getCircuitNodes(this.circuit);
    if (unhealthyNodes.length > Math.floor(circuitNodes.length / 3)) {
      this.notifyListeners(CircuitStatus.REBUILDING);

      // Build new circuit with same length but different nodes
      const newCircuit = await this.circuitBuilder.buildCircuit(
        circuitNodes.length,
        { excludeNodes: unhealthyNodes }
      );

      // Transfer any pending data to new circuit
      await this.circuitBuilder.migrateCircuitData(this.circuit, newCircuit);

      // Update circuit reference
      this.circuit = newCircuit;
      this.notifyListeners(CircuitStatus.READY);
    } else {
      // Replace individual unhealthy nodes
      this.notifyListeners(CircuitStatus.REPAIRING);

      for (const nodeId of unhealthyNodes) {
        await this.replaceNode(nodeId);
      }

      this.notifyListeners(CircuitStatus.READY);
    }
  }

  /**
   * Replace a single node in the circuit
   * @private
   * @param {string} nodeId - ID of node to replace
   */
  async replaceNode(nodeId) {
    const replacement = await this.nodeRegistry.getSuitableRelays(1);
    if (replacement.length === 0) {
      throw new Error('No suitable replacement nodes available');
    }

    await this.circuitBuilder.replaceCircuitNode(
      this.circuit,
      nodeId,
      replacement[0]
    );
  }

  /**
   * Get current circuit health metrics
   * @returns {Object} Circuit health metrics
   */
  async getHealthMetrics() {
    const nodes = await this.nodeRegistry.discoverNodes();
    const circuitNodes = this.circuitBuilder.getCircuitNodes(this.circuit);

    const metrics = {
      totalNodes: circuitNodes.length,
      healthyNodes: 0,
      averageLatency: 0,
      bandwidth: Infinity,
      nodeMetrics: [],
      timestamp: Date.now()
    };

    let totalLatency = 0;

    for (const nodeId of circuitNodes) {
      const node = nodes.find(n => n.nodeId === nodeId);
      const nodeMetric = {
        nodeId,
        status: node?.status || 'OFFLINE',
        role: node?.role || 'UNKNOWN',
        location: node?.location || null
      };

      if (node && node.status === NodeStatus.AVAILABLE) {
        metrics.healthyNodes++;
        const capabilities = await this.nodeRegistry.getNodeCapabilities(nodeId);
        nodeMetric.latency = capabilities.latency;
        nodeMetric.bandwidth = capabilities.maxBandwidth;
        nodeMetric.reliability = capabilities.reliability;
        nodeMetric.uptime = capabilities.uptime;

        totalLatency += capabilities.latency;
        metrics.bandwidth = Math.min(metrics.bandwidth, capabilities.maxBandwidth);
      }

      metrics.nodeMetrics.push(nodeMetric);
    }

    metrics.averageLatency = totalLatency / metrics.healthyNodes || 0;
    metrics.bandwidth = metrics.bandwidth === Infinity ? 0 : metrics.bandwidth;
    return metrics;
  }
}
