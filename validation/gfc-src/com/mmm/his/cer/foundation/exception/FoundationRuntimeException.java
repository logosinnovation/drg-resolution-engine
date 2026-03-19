package com.mmm.his.cer.foundation.exception;
public class FoundationRuntimeException extends RuntimeException {
    public FoundationRuntimeException() { super(); }
    public FoundationRuntimeException(String msg) { super(msg); }
    public FoundationRuntimeException(String msg, Throwable cause) { super(msg, cause); }
}
