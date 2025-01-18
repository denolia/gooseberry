'use client';

import { useState } from 'react';
import styles from './WordInput.module.css';
import ReactMarkdown from 'react-markdown';

export function WordInput() {
  const [word, setWord] = useState('');
  const [translation, setTranslation] = useState()
  const [isLoading, setIsLoading] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWord(e.target.value);
  };

  const handleKeyUp = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && word.trim()) {
      setIsLoading(true);
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: word }),
        });

        const data = await response.json();

        const translation =   data["translation"]
        if (translation){
          setTranslation(translation);
        }
      } catch (error) {
        console.error('Translation error:', error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  return (
    <div className={styles.container}>
      <input 
        type="text"
        value={word}
        onChange={handleInputChange}
        onKeyUp={handleKeyUp}
        placeholder="Enter a German word..."
        className={styles.input}
        disabled={isLoading}
      />
      {isLoading && <div>Translating...</div>}
      {translation && <ReactMarkdown className={styles.translation}>{translation}</ReactMarkdown>}

    </div>
  );
} 