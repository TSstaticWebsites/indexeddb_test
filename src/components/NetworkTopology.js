import React, { useEffect, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap
} from 'react-flow-renderer';
import { geoMercator } from 'd3-geo';
import { Network } from '@visx/network';
import { forceSimulation, forceLink, forceManyBody, forceCenter } from 'd3-force';

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
    const radius = Math.min(layout.width, layout.height) * 0.4;
    const angle = (index / total) * 2 * Math.PI;
    return {
      x: layout.width / 2 + radius * Math.cos(angle),
      y: layout.height / 2 + radius * Math.sin(angle)
    };
  };

  const getNodeStyle = (node, circuit) => {
    const baseStyle = {
      padding: 10,
      borderRadius: '50%',
      border: '1px solid #777',
      width: 60,
      height: 60,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    };

    // Handle waiting state for ENTRY nodes
    if (isWaiting && node.role === 'ENTRY') {
      return {
        ...baseStyle,
        backgroundColor: '#fff3e0',
        borderColor: '#ff9800',
        borderWidth: 2,
        animation: 'pulse 1.5s infinite',
        className: 'node-waiting'
      };
    }

    if (circuit && circuit.nodes.includes(node.nodeId)) {
      return {
        ...baseStyle,
        backgroundColor: '#e6ffe6',
        borderColor: '#006600',
        borderWidth: 2,
      };
    }

    return {
      ...baseStyle,
      backgroundColor: node.status === 'AVAILABLE' ? '#fff' : '#f5f5f5',
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
