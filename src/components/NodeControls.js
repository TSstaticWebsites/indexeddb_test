import React, { useState, useEffect } from 'react';
import { NodeRole, NodeStatus } from '../lib/onion/nodeRegistry';
import { CircuitStatus } from '../lib/onion/circuitBuilder';
import { CircuitMonitor } from '../lib/onion/circuitMonitor';
import NetworkTopology from './NetworkTopology';
import CircuitHealthDashboard from './CircuitHealthDashboard';
import FileRoutingVisualizer from './FileRoutingVisualizer';
import './NodeControls.css';

const NodeControls = ({ nodeRegistry, circuitBuilder, currentCircuit, onCircuitChange }) => {
  const [availableNodes, setAvailableNodes] = useState([]);
  const [circuitLength, setCircuitLength] = useState(3);
  const [localNodeRole, setLocalNodeRole] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('role') || NodeRole.RELAY;
  });
  const [localNodeStatus, setLocalNodeStatus] = useState(NodeStatus.AVAILABLE);
  const [circuitHealth, setCircuitHealth] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [isWaiting, setIsWaiting] = useState(false);

  useEffect(() => {
    const fetchNodes = async () => {
      const nodes = await nodeRegistry.discoverNodes();
      setAvailableNodes(nodes);

      // Auto-connect for ENTRY nodes and show waiting state
      if (localNodeRole === NodeRole.ENTRY && nodes.length < 3) {
        setIsWaiting(true);
      } else if (localNodeRole === NodeRole.ENTRY && nodes.length >= 3 && isWaiting) {
        setIsWaiting(false);
        handleCircuitLengthChange(3); // Automatically build circuit when enough nodes are available
      }
    };

    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, [nodeRegistry, localNodeRole, isWaiting]);

  useEffect(() => {
    if (currentCircuit && circuitBuilder && nodeRegistry) {
      const newMonitor = new CircuitMonitor(currentCircuit, circuitBuilder, nodeRegistry);

      const handleStatusChange = async (status, details) => {
        if (status === CircuitStatus.DEGRADED) {
          console.warn('Circuit degraded:', details.unhealthyNodes);
        }
        const metrics = await newMonitor.getHealthMetrics();
        setCircuitHealth(metrics);
      };

      newMonitor.addStatusListener(handleStatusChange);
      newMonitor.startMonitoring(5000);
      setMonitor(newMonitor);

      return () => {
        newMonitor.stopMonitoring();
        newMonitor.removeStatusListener(handleStatusChange);
      };
    }
  }, [currentCircuit, circuitBuilder, nodeRegistry]);

  const handleRoleChange = async (role) => {
    console.log(`[NodeControls] Changing role to:`, role);
    setLocalNodeRole(role);
    await nodeRegistry.registerAsNode(role);
  };

  const handleStatusChange = (status) => {
    setLocalNodeStatus(status);
    nodeRegistry.updateStatus(status);
  };

  const handleCircuitLengthChange = async (length) => {
    if (length < 3) {
      alert('Minimum circuit length is 3 hops for anonymity');
      return;
    }
    setCircuitLength(length);
    if (currentCircuit) {
      await circuitBuilder.closeCircuit(currentCircuit);
      const { circuitId } = await circuitBuilder.buildCircuit(length);
      onCircuitChange(circuitId);
    }
  };

  return (
    <div className="node-controls">
      <h2>Node Management</h2>

      {isWaiting && (
        <div className="waiting-state">
          <p>Waiting for more nodes to join the network... ({availableNodes.length}/3 nodes available)</p>
        </div>
      )}

      <NetworkTopology
        nodes={availableNodes}
        currentCircuit={currentCircuit}
        circuitHealth={circuitHealth}
        isWaiting={isWaiting}
      />

      <CircuitHealthDashboard
        circuit={currentCircuit}
        health={circuitHealth}
        transferStats={{
          speed: circuitHealth?.bandwidth ? Math.round(circuitHealth.bandwidth / 1024) : 0,
          efficiency: circuitHealth?.healthyNodes ? (circuitHealth.healthyNodes / circuitHealth.totalNodes) * 100 : 0
        }}
      />

      <FileRoutingVisualizer
        circuit={currentCircuit}
        currentChunk={0}
        totalChunks={100}
        transferDirection="outbound"
      />

      <div className="control-section">
        <h3>Local Node Settings</h3>
        <div className="control-group">
          <label>Role:</label>
          <select value={localNodeRole} onChange={(e) => handleRoleChange(e.target.value)}>
            <option value={NodeRole.RELAY}>Relay</option>
            <option value={NodeRole.EXIT}>Exit</option>
            <option value={NodeRole.ENTRY}>Entry</option>
          </select>
        </div>

        <div className="control-group">
          <label>Status:</label>
          <select value={localNodeStatus} onChange={(e) => handleStatusChange(e.target.value)}>
            <option value={NodeStatus.AVAILABLE}>Available</option>
            <option value={NodeStatus.BUSY}>Busy</option>
          </select>
        </div>
      </div>

      <div className="control-section">
        <h3>Circuit Settings</h3>
        <div className="control-group">
          <label>Circuit Length (hops):</label>
          <input
            type="number"
            min="3"
            value={circuitLength}
            onChange={(e) => handleCircuitLengthChange(Number(e.target.value))}
          />
          <small>Minimum 3 hops required for anonymity</small>
        </div>
      </div>

      <div className="control-section">
        <h3>Network Nodes ({availableNodes.length})</h3>
        <div className="node-list">
          {availableNodes.map((node) => (
            <div key={node.nodeId} className="node-item">
              <span className="node-role">{node.role}</span>
              <span className={`node-status status-${node.status.toLowerCase()}`}>
                {node.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default NodeControls;
