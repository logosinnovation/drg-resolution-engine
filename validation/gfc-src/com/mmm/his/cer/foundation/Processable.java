package com.mmm.his.cer.foundation;
import com.mmm.his.cer.foundation.exception.FoundationException;
import com.mmm.his.cer.foundation.transfer.IClaim;
public interface Processable<C extends IClaim, K, R extends ComponentRuntime<K>> {
    void process(C claim) throws FoundationException;
    void reconfigure(R options) throws FoundationException;
    void close();
}
