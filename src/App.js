import React, { useState, useEffect } from 'react';
import FileTransferComponent from './FileTransferComponent';
import {
  addFile,
  getFile,
  getAllFiles,
  deleteFile,
  calculateIndexedDBSize,
} from './db';
import './App.css';

function App() {
  const [selectedFile, setSelectedFile] = useState(null);
  const [storedFiles, setStoredFiles] = useState([]);
  const [displayedFile, setDisplayedFile] = useState(null);
  const [totalStorageUsed, setTotalStorageUsed] = useState(0);

  useEffect(() => {
    fetchStoredFiles();
  }, []);

  const fetchStoredFiles = async () => {
    const files = await getAllFiles();
    setStoredFiles(files);
    await calculateTotalStorageUsed(); // Update storage used
  };

  const calculateTotalStorageUsed = async () => {
    const totalSize = await calculateIndexedDBSize();
    setTotalStorageUsed(totalSize);
  };

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (selectedFile) {
      await addFile(selectedFile);
      setSelectedFile(null);
      fetchStoredFiles();
    } else {
      alert('Please select a file to upload.');
    }
  };

  const handleDisplay = async (id) => {
    const fileData = await getFile(id);
    if (fileData) {
      const url = URL.createObjectURL(fileData.data);
      setDisplayedFile({ ...fileData, url });
    }
  };

  const handleDelete = async (id) => {
    await deleteFile(id);
    fetchStoredFiles();
    if (displayedFile && displayedFile.id === id) {
      setDisplayedFile(null);
    }
  };

  const handleDownload = async (id) => {
    const fileData = await getFile(id);
    if (fileData) {
      const url = URL.createObjectURL(fileData.data);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileData.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      fetchStoredFiles();
    }
  };

  function formatBytes(bytes, decimals = 2) {
    const gb = 1024 * 1024 * 1024;
    if (bytes === 0) return '0 GB';
    const dm = decimals < 0 ? 0 : decimals;
    const sizeInMB = bytes / gb;
    return sizeInMB.toFixed(dm) + ' GB';
  }

  return (
    <>
      <div className="container">
        <h1>IndexedDB</h1>
        <div style={{ marginBottom: '20px' }}>
          <input type="file" onChange={handleFileChange} />
          <button onClick={handleUpload}>Upload File</button>
        </div>

        <h2>Stored Files</h2>
        <p>Total Storage Used: {formatBytes(totalStorageUsed)}</p>
        {storedFiles.length === 0 ? (
          <div className="empty-state">
              <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  strokeWidth="2"
                  stroke="currentColor"
                  className="empty-state-icon"
              >
                  <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 10.5l8.25 8.25l8.25-8.25M11.25 18.75V4.5" 
                  />
              </svg>
              <p>No files available in storage. Upload one to get started!</p>
          </div>
        ) : (
            <ul>
                {storedFiles.map((file) => (
                    <li key={file.id}>
                        <span>
                            <strong>{file.fileName}</strong>
                        </span>
                        <div>
                            <button onClick={() => handleDisplay(file.id)}>Display</button>
                            <button onClick={() => handleDownload(file.id)}>Download</button>
                            <button onClick={() => handleDelete(file.id)}>Delete</button>
                        </div>
                    </li>
                ))}
            </ul>
        )}

        {displayedFile && (
          <div style={{ marginTop: '20px' }}>
            <h2>Displaying File: {displayedFile.fileName}</h2>
            {displayedFile.fileType.startsWith('image/') && (
              <img
                src={displayedFile.url}
                alt={displayedFile.fileName}
                style={{ maxWidth: '100%' }}
              />
            )}
            {displayedFile.fileType.startsWith('video/') && (
              <video
                src={displayedFile.url}
                controls
                style={{ maxWidth: '100%' }}
              ></video>
            )}
            {!displayedFile.fileType.startsWith('image/') &&
              !displayedFile.fileType.startsWith('video/') && (
                <p>Unsupported file type.</p>
              )}
          </div>
        )}
        <div>
          <FileTransferComponent fetchStoredFiles={fetchStoredFiles}/>
        </div>
      </div>
      <footer>
        <p>© 2024 All rights reserved.</p>
      </footer>
    </>
  );
}

export default App;
