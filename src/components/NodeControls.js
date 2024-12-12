import React, { useState, useEffect } from 'react';
import { NodeRole, NodeStatus } from '../lib/onion/nodeRegistry';
import { CircuitStatus } from '../lib/onion/circuitBuilder';
import { CircuitMonitor } from '../lib/onion/circuitMonitor';
import './NodeControls.css';

const NodeControls = ({ nodeRegistry, circuitBuilder, currentCircuit, onCircuitChange }) => {
  const [availableNodes, setAvailableNodes] = useState([]);
  const [circuitLength, setCircuitLength] = useState(3);
  const [localNodeRole, setLocalNodeRole] = useState(NodeRole.RELAY);
  const [localNodeStatus, setLocalNodeStatus] = useState(NodeStatus.AVAILABLE);
  const [circuitHealth, setCircuitHealth] = useState(null);
  const [monitor, setMonitor] = useState(null);

  useEffect(() => {
    const fetchNodes = async () => {
      const nodes = await nodeRegistry.discoverNodes();
      setAvailableNodes(nodes);
    };

    fetchNodes();
    const interval = setInterval(fetchNodes, 10000);
    return () => clearInterval(interval);
  }, [nodeRegistry]);

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
        <h3>Circuit Health</h3>
        {circuitHealth ? (
          <div className="health-metrics">
            <div className="metric">
              <label>Healthy Nodes:</label>
              <span>{circuitHealth.healthyNodes} / {circuitHealth.totalNodes}</span>
            </div>
            <div className="metric">
              <label>Average Latency:</label>
              <span>{Math.round(circuitHealth.averageLatency)}ms</span>
            </div>
            <div className="metric">
              <label>Available Bandwidth:</label>
              <span>{Math.round(circuitHealth.bandwidth / 1024)} KB/s</span>
            </div>
          </div>
        ) : (
          <p>No circuit health data available</p>
        )}
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
