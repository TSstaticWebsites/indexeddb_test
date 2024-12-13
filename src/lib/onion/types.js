/**
 * Type definitions for onion routing implementation
 */

export const NodeRole = {
  ENTRY: 'ENTRY',
  RELAY: 'RELAY',
  EXIT: 'EXIT'
};

export const NodeStatus = {
  AVAILABLE: 'AVAILABLE',
  BUSY: 'BUSY',
  OFFLINE: 'OFFLINE',
  WAITING: 'WAITING'  // Status for nodes waiting for connections
};
