import { CircuitStatus } from './circuitBuilder';

export class CircuitChannel {
  constructor(circuit, circuitBuilder) {
    this.circuit = circuit;
    this.circuitBuilder = circuitBuilder;
    this.chunkSize = 16 * 1024; // Match existing chunk size
    this.maxBufferedAmount = 64 * 1024; // Match existing buffer limit
    this.onmessage = null;
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.readyState = 'connecting';
  }

  async connect() {
    try {
      const status = await this.circuitBuilder.getCircuitStatus(this.circuit);
      if (status === CircuitStatus.READY) {
        this.readyState = 'open';
        this.onopen?.();
        return true;
      }
      throw new Error('Circuit not ready');
    } catch (error) {
      this.readyState = 'closed';
      this.onerror?.(error);
      return false;
    }
  }

  async send(data) {
    if (this.readyState !== 'open') {
      throw new Error('Circuit channel not open');
    }

    try {
      if (typeof data === 'string') {
        // Handle string data (metadata)
        await this.circuitBuilder.sendThroughCircuit(
          this.circuit,
          new TextEncoder().encode(data)
        );
      } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
        // Handle binary data (file chunks)
        await this.circuitBuilder.sendThroughCircuit(this.circuit, data);
      } else {
        throw new Error('Unsupported data type');
      }
    } catch (error) {
      this.onerror?.(error);
      throw error;
    }
  }

  async receive(data) {
    if (this.readyState !== 'open') {
      return;
    }

    try {
      // Handle received data from circuit
      if (this.onmessage) {
        const event = { data };
        this.onmessage(event);
      }
    } catch (error) {
      this.onerror?.(error);
    }
  }

  close() {
    if (this.readyState === 'closed') {
      return;
    }

    this.readyState = 'closed';
    this.circuitBuilder.closeCircuit(this.circuit);
    this.onclose?.();
  }
}
