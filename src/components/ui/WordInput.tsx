'use client';

import { useState } from 'react';
import styles from './WordInput.module.css';

export function WordInput() {
  const [word, setWord] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWord(e.target.value);
  };

  return (
    <div className={styles.container}>
      <input 
        type="text"
        value={word}
        onChange={handleInputChange}
        placeholder="Enter a word..."
        className={styles.input}
      />
    </div>
  );
} 