import React, { useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap
} from 'react-flow-renderer';
import { Network } from '@visx/network';
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force';
import { NodeStatus } from '../lib/onion/types';

const NetworkTopology = ({
  nodes = [],
  currentCircuit = null,
  circuitHealth = {},
  isWaiting = false
}) => {
  const [elements, setElements] = useState([]);
  const [layout, setLayout] = useState({ width: 800, height: 600 });

  useEffect(() => {
    // Transform nodes into ReactFlow elements
    const nodeElements = nodes.map((node, index) => ({
      id: node.nodeId,
      type: 'default',
      data: {
        label: `Node ${node.nodeId.slice(0, 8)}`,
        role: node.role,
        status: node.status
      },
      position: calculateNodePosition(node, index, nodes.length),
      style: getNodeStyle(node, currentCircuit)
    }));

    // Create edges for the current circuit
    const edgeElements = currentCircuit ? createCircuitEdges(currentCircuit) : [];

    setElements([...nodeElements, ...edgeElements]);
  }, [nodes, currentCircuit, circuitHealth]);

  const calculateNodePosition = (node, index, total) => {
    // Use force-directed layout for more natural network topology
    const angle = (index / total) * 2 * Math.PI;
    const radius = Math.min(layout.width, layout.height) * 0.35;
    const jitter = Math.random() * 20 - 10; // Add slight randomness for more organic look
    return {
      x: layout.width / 2 + (radius + jitter) * Math.cos(angle),
      y: layout.height / 2 + (radius + jitter) * Math.sin(angle)
    };
  };

  const getNodeStyle = (node, circuit) => {
    const baseStyle = {
      padding: 10,
      borderRadius: '50%',
      border: '2px solid #777',
      width: 70,
      height: 70,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      fontSize: '0.8em',
      transition: 'all 0.3s ease'
    };

    // Role-specific colors
    const roleColors = {
      ENTRY: '#4CAF50',
      RELAY: '#2196F3',
      EXIT: '#FF9800'
    };

    // Handle waiting state
    if (isWaiting && (node.status === 'WAITING' || node.status === NodeStatus.WAITING)) {
      return {
        ...baseStyle,
        backgroundColor: '#fff3e0',
        borderColor: roleColors[node.role] || '#777',
        borderWidth: 2,
        animation: 'pulse 1.5s infinite',
        className: 'node-waiting',
        opacity: 1 // Ensure waiting nodes are fully visible
      };
    }

    // Handle circuit nodes
    if (circuit && circuit.nodes.includes(node.nodeId)) {
      return {
        ...baseStyle,
        backgroundColor: '#e8f5e9',
        borderColor: roleColors[node.role] || '#006600',
        borderWidth: 3,
        boxShadow: '0 0 10px rgba(0,102,0,0.3)'
      };
    }

    // Default node style based on status and role
    return {
      ...baseStyle,
      backgroundColor: node.status === 'AVAILABLE' ? '#fff' : '#f5f5f5',
      borderColor: roleColors[node.role] || '#777',
      opacity: node.status === 'AVAILABLE' ? 1 : 0.7
    };
  };

  const createCircuitEdges = (circuit) => {
    const edges = [];
    for (let i = 0; i < circuit.nodes.length - 1; i++) {
      edges.push({
        id: `e${circuit.nodes[i]}-${circuit.nodes[i + 1]}`,
        source: circuit.nodes[i],
        target: circuit.nodes[i + 1],
        animated: true,
        style: { stroke: '#006600' }
      });
    }
    return edges;
  };

  return (
    <div style={{ width: '100%', height: '400px' }}>
      <ReactFlow
        elements={elements}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        snapToGrid={true}
        snapGrid={[15, 15]}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  );
};

export default NetworkTopology;
