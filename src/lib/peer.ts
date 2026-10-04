import Peer from 'peerjs';

export function createPeer() {
  return new Peer({
    debug: 0,
    config: {
      // STUN discovers a direct route. No TURN media relay is configured.
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
      ],
      iceTransportPolicy: 'all',
    },
  });
}

export function peerErrorMessage(type: string) {
  switch (type) {
    case 'peer-unavailable':
      return 'The source is offline or this link has expired. Ask the sender for a new link.';
    case 'browser-incompatible':
      return 'This browser does not support direct streaming. Try a current version of Chrome or Firefox.';
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return 'Could not reach the connection service. Check your internet connection and try again.';
    default:
      return 'The direct connection could not be established. Try again, or use the VLC helper on a trusted network.';
  }
}